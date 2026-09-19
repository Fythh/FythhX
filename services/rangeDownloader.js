/**
 * rangeDownloader.js
 *
 * "Option B" fix for FytX's Remote Trim bug (stuck / 403 Forbidden).
 *
 * Root cause (see docs): `--download-sections` hands the cut off to FFmpeg,
 * which seeks into the remote DASH stream over plain HTTP. FFmpeg's HTTP
 * protocol handler isn't good at reading the `sidx` index of a fragmented
 * mp4/webm, so it often ends up scanning from byte 0, which is both slow
 * AND looks like bot behaviour to YouTube -> 403.
 *
 * Fix: do exactly what the YouTube web player itself does.
 *   1. `yt-dlp -g` -> direct googlevideo.com URLs for video + audio
 *   2. Probe the first few MB of each stream to find `moov` + `sidx`
 *   3. Parse `sidx` ourselves (mp4BoxParser.js) to get a byte-offset table
 *      of every DASH segment and its timestamp range. Some longer videos
 *      use a HIERARCHICAL sidx (entries pointing to another sidx box
 *      instead of media) — resolveMediaSegments() walks that recursively.
 *   4. Issue ONE Range request per stream covering only the segments that
 *      overlap [start, end] (+ a little padding for keyframe safety)
 *   5. Reassemble a valid local fragmented-mp4 (init segment + segments)
 *      for video and audio, IN PARALLEL
 *   6. Mux video+audio together with a LOCAL ffmpeg using `-copyts` (keeps
 *      each stream's true original absolute timestamps — this is what
 *      keeps them in sync, since video/audio have independently-chosen
 *      DASH segment boundaries and don't start at exactly the same time),
 *      then trim precisely using the ORIGINAL absolute start/end seconds.
 */

'use strict';

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { config } = require('../config/config');

const toolPaths = require('../utils/toolPaths');
const { parseTopLevelBoxes, parseSidx } = require('./mp4BoxParser');

const PROBE_CHUNK_SIZE = 5 * 1024 * 1024;   // start by probing 5MB
const PROBE_MAX_SIZE = 30 * 1024 * 1024;    // give up after 30MB total probed
const SEGMENT_PADDING_SEC = 3;              // grab 1 extra segment each side
const MAX_SIDX_RECURSION_DEPTH = 4;         // safety cap for daisy-chained sidx

// ---------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------

function getCookieHeader() {
  const cookiePath = path.join(__dirname, '..', 'cookies.txt');
  if (fs.existsSync(cookiePath)) {
    try {
      const content = fs.readFileSync(cookiePath, 'utf8');
      const cookies = [];
      content.split('\n').forEach(line => {
        if (!line || line.startsWith('#')) return;
        const parts = line.split('\t');
        if (parts.length >= 7) {
          cookies.push(`${parts[5]}=${parts[6].trim()}`);
        }
      });
      return cookies.join('; ');
    } catch (e) {
      console.warn('Gagal membaca cookies.txt:', e.message);
    }
  }
  return '';
}

/** Get direct stream URL(s) for a yt-dlp format selector (one per "+"-joined component, in order). */
function getDirectUrls(url, formatSelector, cookieArgs, registerProcess) {
  return new Promise((resolve, reject) => {
    const args = [
      '-f', formatSelector,
      '-g',
      '--no-warnings',
      '--force-ipv4', // Add this to match proxy and prevent IPv6 mismatch!
      '--js-runtimes', 'node',
      ...cookieArgs,
      url
    ];
    const proc = execFile(toolPaths.ytdlp, args, { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`yt-dlp -g gagal: ${(stderr || err.message).slice(0, 300)}`));
      const urls = stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
      if (!urls.length) return reject(new Error('yt-dlp tidak mengembalikan URL langsung'));
      resolve(urls);
    });
    if (registerProcess) registerProcess(proc);
  });
}

async function fetchRange(url, start, end, attempt = 1, useQueryParam = false, onProgress = null) {
  const expectedSize = end - start + 1;
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
  };
  
  if (!useQueryParam) {
    headers['Range'] = `bytes=${start}-${end}`;
  }
  
  // CRITICAL FIX: Do NOT pass youtube.com cookies to googlevideo.com media URLs!
  // It causes HTTP 400 Bad Request because the cookies are cross-domain and invalid!
  
  const targetUrl = useQueryParam ? `${url}${url.includes('?') ? '&' : '?'}range=${start}-${end}` : url;
  const res = await fetch(targetUrl, { headers });

  if ((res.status === 403 || res.status === 400) && attempt <= 3) {
    console.log(`[rangeDownloader] Dapet ${res.status}. Retry attempt ${attempt}... (useQueryParam: ${!useQueryParam})`);
    await new Promise(r => setTimeout(r, 2000));
    // If we haven't tried query param yet, try it next. Otherwise keep retrying.
    return fetchRange(url, start, end, attempt + 1, !useQueryParam, onProgress);
  }

  if (res.status !== 206 && res.status !== 200) {
    throw new Error(
      `Server tidak balas 206/200 untuk bytes=${start}-${end} (dapet HTTP ${res.status}). ` +
      `Kemungkinan Range header di-ignore — abort supaya gak ke-download full file diam-diam.`
    );
  }

  // Read response as stream to track progress
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress) {
      onProgress(received, expectedSize);
    }
  }

  const buf = Buffer.concat(chunks);

  // If status is 200, we MUST verify the size closely to ensure we didn't just download the entire 4GB video
  if (buf.length > expectedSize * 1.05 + 1024) {
    throw new Error(
      `Body response (${buf.length} bytes) jauh lebih besar dari range yang diminta (${expectedSize} bytes) ` +
      `untuk bytes=${start}-${end} — kemungkinan server ignore Range, abort.`
    );
  }

  return buf;
}

/**
 * Probe a remote DASH stream to find its init segment (ftyp+moov) and
 * its `sidx` segment index, growing the probed range if needed.
 */
async function probeInitAndSidx(url) {
  let chunkSize = PROBE_CHUNK_SIZE;

  while (chunkSize <= PROBE_MAX_SIZE) {
    const buf = await fetchRange(url, 0, chunkSize - 1);
    const boxes = parseTopLevelBoxes(buf, 0);

    const moovBox = boxes.find(b => b.type === 'moov');
    const sidxBox = boxes.find(b => b.type === 'sidx');

    if (moovBox && sidxBox && sidxBox.end <= buf.length) {
      const sidxBuf = buf.slice(sidxBox.start, sidxBox.end);
      const sidxHeaderSize = sidxBuf.readUInt32BE(0) === 1 ? 16 : 8;
      const sidxIndex = parseSidx(sidxBuf, sidxHeaderSize, sidxBox.end);

      const initSegment = buf.slice(0, sidxBox.start);

      return { initSegment, sidxIndex };
    }

    chunkSize *= 2;
  }

  throw new Error('Tidak ketemu moov/sidx dalam batas probe 30MB (stream mungkin bukan fragmented mp4)');
}

/**
 * Some YouTube DASH assets (typically longer videos) use a HIERARCHICAL /
 * "daisy-chained" sidx: some of the root sidx's references don't point
 * directly at media (moof+mdat) — they point at ANOTHER sidx box covering
 * a sub-range of the timeline (reference_type === 1). Treating those as
 * media and grabbing their bytes directly gets you the raw index box
 * instead of video — a tiny, corrupted, way-too-short result.
 *
 * This walks the tree down to actual media (reference_type === 0) segments
 * overlapping [paddedStart, paddedEnd], fetching child sidx boxes on demand.
 */
async function resolveMediaSegments(url, segments, paddedStart, paddedEnd, depth = 0) {
  if (depth > MAX_SIDX_RECURSION_DEPTH) {
    throw new Error('sidx nested terlalu dalam (>4 level) — struktur DASH tidak terduga');
  }

  const overlapping = segments.filter(s => s.timeEnd > paddedStart && s.timeStart < paddedEnd);
  const resolved = [];

  for (const seg of overlapping) {
    if (seg.referenceType === 0) {
      resolved.push(seg);
      continue;
    }

    // reference_type === 1: this "segment" is actually another sidx box — fetch + recurse.
    const childBuf = await fetchRange(url, seg.byteStart, seg.byteEnd);
    const childHeaderSize = childBuf.readUInt32BE(0) === 1 ? 16 : 8;
    const childType = childBuf.toString('ascii', 4, 8);
    if (childType !== 'sidx') {
      throw new Error(`Diharapkan child sidx box tapi dapet '${childType}' di offset ${seg.byteStart}`);
    }
    const childAbsEnd = seg.byteEnd + 1; // anchor = byte right after this child sidx box
    const childIndex = parseSidx(childBuf, childHeaderSize, childAbsEnd);
    const childResolved = await resolveMediaSegments(url, childIndex.segments, paddedStart, paddedEnd, depth + 1);
    resolved.push(...childResolved);
  }

  return resolved;
}

async function downloadStreamSegment(url, startSec, endSec, outPath, onProgress = null) {
  const { initSegment, sidxIndex } = await probeInitAndSidx(url);

  const paddedStart = Math.max(0, startSec - SEGMENT_PADDING_SEC);
  const paddedEnd = endSec + SEGMENT_PADDING_SEC;

  const mediaSegments = await resolveMediaSegments(url, sidxIndex.segments, paddedStart, paddedEnd);
  if (!mediaSegments.length) {
    throw new Error(`Tidak ada segmen media yang overlap rentang waktu ${startSec}-${endSec}s`);
  }

  const byteStart = Math.min(...mediaSegments.map(s => s.byteStart));
  const byteEnd = Math.max(...mediaSegments.map(s => s.byteEnd));
  const timeStart = Math.min(...mediaSegments.map(s => s.timeStart));

  const segmentBuf = await fetchRange(url, byteStart, byteEnd, 1, false, onProgress);

  const fd = fs.openSync(outPath, 'w');
  fs.writeSync(fd, initSegment);
  fs.writeSync(fd, segmentBuf);
  fs.closeSync(fd);
  
  return timeStart;
}

/**
 * Mux the local video+audio fragments and cut precisely with LOCAL ffmpeg.
 *
 * TWO STAGES:
 *
 *   Stage 1 (mux): combine video+audio fragments into one local file.
 *   `-copyts` is CRITICAL here — video and audio have INDEPENDENTLY chosen
 *   DASH segment boundaries (their sidx tables are separate), so the first
 *   downloaded video frame and the first downloaded audio sample almost
 *   never start at exactly the same absolute time. Without `-copyts`,
 *   ffmpeg's muxer resets each stream's timestamps toward 0 independently,
 *   silently throwing away the true relative offset between them — that's
 *   what causes audio to drift/delay. `-copyts` keeps each stream's real
 *   original timestamp, so their true relative alignment survives the mux.
 *
 *   Stage 2 (trim): cut with the ORIGINAL ABSOLUTE start/end seconds
 *   (no relative-offset math needed — that's exactly the kind of hack that
 *   breaks if video/audio start at different times, which they do here).
 *   `-avoid_negative_ts make_zero` normalizes the final output to start
 *   at 0 for normal playback.
 */
function muxAndTrimLocal(videoPath, audioPath, startSec, endSec, outPath, registerProcess, videoTimeStart, audioTimeStart) {
  return new Promise((resolve, reject) => {
    // Gunakan nama file ASCII sederhana untuk FFmpeg agar terhindar dari isu Unicode mangling di Windows
    const stamp = Date.now() + '_' + Math.floor(Math.random() * 10000);
    const tempMuxPath = path.join(path.dirname(outPath), `tmp_mux_${stamp}.mp4`);
    const tempTrimPath = path.join(path.dirname(outPath), `tmp_trim_${stamp}.mp4`);
    
    // Calculate relative offsets for sync
    const baseTime = Math.min(videoTimeStart, audioTimeStart);
    const videoOffset = Math.max(0, videoTimeStart - baseTime);
    const audioOffset = Math.max(0, audioTimeStart - baseTime);

    const muxArgs = [
      '-y',
      ...(videoOffset > 0 ? ['-itsoffset', String(videoOffset)] : []),
      '-i', videoPath,
      ...(audioOffset > 0 ? ['-itsoffset', String(audioOffset)] : []),
      '-i', audioPath,
      '-map', '0:v:0', '-map', '1:a:0?', // a:0? so a missing/broken audio stream doesn't hard-fail the mux
      '-c', 'copy',
      tempMuxPath
    ];

    const procMux = spawn(toolPaths.ffmpeg, muxArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (registerProcess) registerProcess(procMux);
    let muxError = '';
    procMux.stderr.on('data', (d) => { muxError += d.toString(); });

    procMux.on('close', (code1) => {
      if (code1 !== 0) {
        return reject(new Error(`Tahap 1 (Mux) gagal (code ${code1}): ${muxError.slice(-500)}`));
      }
      
      const relativeStart = Math.max(0, startSec - baseTime);
      const relativeEnd = endSec - baseTime;

      const trimArgs = [
        '-y',
        '-ss', String(relativeStart), '-to', String(relativeEnd),
        '-i', tempMuxPath,
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        tempTrimPath
      ];

      const procTrim = spawn(toolPaths.ffmpeg, trimArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      if (registerProcess) registerProcess(procTrim);
      let trimError = '';
      procTrim.stderr.on('data', (d) => { trimError += d.toString(); });

      procTrim.on('close', (code2) => {
        try { fs.existsSync(tempMuxPath) && fs.unlinkSync(tempMuxPath); } catch (_) { /* ignore */ }
        
        if (code2 === 0) {
          // Check if tempTrimPath exists (ffmpeg should have successfully written it)
          if (fs.existsSync(tempTrimPath)) {
            try {
              // Rename safe temp path to actual requested outPath
              fs.renameSync(tempTrimPath, outPath);
              resolve(outPath);
            } catch (err) {
              reject(new Error(`Gagal memindahkan file trim: ${err.message}`));
            }
          } else {
            // It succeeded but no file was created? 
            reject(new Error(`Tahap 2 (Trim) selesai (code 0) tapi file tidak ditemukan. Log: ${trimError.slice(-500)}`));
          }
        } else {
          reject(new Error(`Tahap 2 (Trim) gagal (code ${code2}): ${trimError.slice(-500)}`));
        }
      });
      procTrim.on('error', (err) => reject(new Error(`Gagal menjalankan ffmpeg (trim): ${err.message}`)));
    });
    procMux.on('error', (err) => reject(new Error(`Gagal menjalankan ffmpeg (mux): ${err.message}`)));
  });
}

function sanitizeFilename(name) {
  return String(name || 'video')
    .replace(/[^\w\s\-\.\(\)\[\]~]/g, '') // Strict allowlist: hanya alphanumeric, spasi, dan tanda baca dasar
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 100) || 'Video_Tanpa_Judul';
}

// ---------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------

/**
 * Download + trim a video via precise byte-range requests instead of
 * `--download-sections` + remote ffmpeg seeking.
 *
 * @param {string} url - YouTube video URL
 * @param {string} formatSelector - yt-dlp format string (e.g. from getTrimFormatString())
 * @param {string|number} start - trim start (seconds)
 * @param {string|number} end - trim end (seconds)
 * @param {string} downloadDir
 * @param {string} title
 * @param {Array<string>} cookieArgs - result of ytDlpService.getCookieArgs()
 * @param {Function} [onProgress]
 * @param {Function} [registerProcess] - called with each spawned child process, for cancellation support
 * @returns {Promise<{success:boolean, message:string, status:string, filePath:string}>}
 */
async function remoteTrimByteRange(url, formatSelector, start, end, downloadDir, title, cookieArgs, onProgress, registerProcess) {
  const emit = (percent, status, speed = null, eta = null) => onProgress && onProgress({ progress: percent, speed, eta, status });

  const tmpDir = config.paths.cache;
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const startSec = parseFloat(start);
  const endSec = parseFloat(end);
  const stamp = Date.now();
  const videoTmp = path.join(tmpDir, `v_trim_${stamp}.mp4`);
  const audioTmp = path.join(tmpDir, `a_trim_${stamp}.m4a`);
  
  // Format float timestamps for filename
  const formatTime = (t) => Number(t).toFixed(2).replace(/\.00$/, '');
  const outPath = path.join(downloadDir, `${sanitizeFilename(title)}_trim_${formatTime(start)}_${formatTime(end)}.mp4`);

  const maxRetries = 2;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      emit(2, attempt > 0 ? `Retrying (attempt ${attempt + 1})...` : 'Preparing download links...');
      const directUrls = await getDirectUrls(url, formatSelector, cookieArgs, registerProcess);
      if (directUrls.length < 2) {
        throw new Error('Selected format does not yield separate video+audio streams (likely progressive/muxed)');
      }
      const [videoUrl, audioUrl] = directUrls;

      emit(10, 'Reading segment index & starting download...');
      
      let videoExpected = 0, audioExpected = 0;
      let videoReceived = 0, audioReceived = 0;
      const downloadStartTime = Date.now();
      
      const formatSpeed = (bytesPerSec) => {
        if (!+bytesPerSec) return '0 B/s';
        const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
        const i = Math.floor(Math.log(bytesPerSec) / Math.log(1024));
        return `${parseFloat((bytesPerSec / Math.pow(1024, i)).toFixed(2))} ${sizes[i]}`;
      };

      const formatEta = (seconds) => {
        if (!seconds || seconds === Infinity) return '-';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
      };

      const updateCombinedProgress = () => {
        const rec = videoReceived + audioReceived;
        const exp = videoExpected + audioExpected;
        if (exp > 0) {
          const percent = (rec / exp); // 0 to 1
          const mappedPercent = 10 + (percent * 70); // Maps 0-1 to 10-80%
          const elapsed = (Date.now() - downloadStartTime) / 1000;
          const speed = elapsed > 0 ? (rec / elapsed) : 0;
          const eta = speed > 0 ? (exp - rec) / speed : 0;
          
          emit(mappedPercent, 'Downloading media fragments...', formatSpeed(speed), formatEta(eta));
        }
      };

      const onVideoProgress = (rec, exp) => {
        videoReceived = rec; videoExpected = exp;
        updateCombinedProgress();
      };

      const onAudioProgress = (rec, exp) => {
        audioReceived = rec; audioExpected = exp;
        updateCombinedProgress();
      };

      const [videoTimeStart, audioTimeStart] = await Promise.all([
        downloadStreamSegment(videoUrl, startSec, endSec, videoTmp, onVideoProgress),
        downloadStreamSegment(audioUrl, startSec, endSec, audioTmp, onAudioProgress)
      ]);
      emit(80, 'Media fragments downloaded successfully');

      emit(85, 'Almost done...');
      await muxAndTrimLocal(videoTmp, audioTmp, startSec, endSec, outPath, registerProcess, videoTimeStart, audioTimeStart);

      emit(100, 'Success');
      if (fs.existsSync(videoTmp)) fs.unlinkSync(videoTmp);
      if (fs.existsSync(audioTmp)) fs.unlinkSync(audioTmp);
      return { success: true, message: 'Download complete', status: 'Done', filePath: outPath };
    } catch (err) {
      if (fs.existsSync(videoTmp)) fs.unlinkSync(videoTmp);
      if (fs.existsSync(audioTmp)) fs.unlinkSync(audioTmp);

      // If it's a 403 / Range ignore error, retry it with a fresh URL
      const isNetworkOr403 = err.message.includes('403') || err.message.includes('Range header di-ignore') || err.message.includes('fetch');
      if (isNetworkOr403 && attempt < maxRetries) {
        attempt++;
        console.log(`[remoteTrimByteRange] Failed with 403/network error. Retrying attempt ${attempt}...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      
      throw err; // Throw if max retries reached or it's a different error
    }
  }
}

module.exports = { remoteTrimByteRange, getDirectUrls, probeInitAndSidx };
