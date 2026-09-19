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
 *      of every DASH segment and its timestamp range
 *   4. Issue ONE Range request per stream covering only the segments that
 *      overlap [start, end] (+ a little padding for keyframe safety)
 *   5. Reassemble a valid local fragmented-mp4 (init segment + segments)
 *   6. Mux + trim with a LOCAL ffmpeg (`-c copy`, exact, fast, no network
 *      flakiness at all — this part is identical to the existing, already
 *      reliable `trimLocalFile` fast path)
 */

'use strict';

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const toolPaths = require('../utils/toolPaths');
const { parseTopLevelBoxes, parseSidx } = require('./mp4BoxParser');

const PROBE_CHUNK_SIZE = 5 * 1024 * 1024;   // start by probing 5MB
const PROBE_MAX_SIZE = 30 * 1024 * 1024;    // give up after 30MB total probed
const SEGMENT_PADDING_SEC = 3;              // grab 1 extra segment each side

// ---------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------

/** Get direct stream URL(s) for a yt-dlp format selector (one per "+"-joined component, in order). */
function getDirectUrls(url, formatSelector, cookieArgs) {
  return new Promise((resolve, reject) => {
    const args = [
      '-f', formatSelector,
      '-g',
      '--no-warnings',
      '--js-runtimes', 'node',
      ...cookieArgs,
      url
    ];
    execFile(toolPaths.ytdlp, args, { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`yt-dlp -g gagal: ${(stderr || err.message).slice(0, 300)}`));
      const urls = stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
      if (!urls.length) return reject(new Error('yt-dlp tidak mengembalikan URL langsung'));
      resolve(urls);
    });
  });
}

/**
 * Fetch an inclusive byte range [start, end] from a URL. Requires Node 18+ (global fetch).
 *
 * STRICT about the server actually honouring the Range header: if it comes
 * back as 200 (not 206) or with a body bigger than what we asked for, we
 * abort instead of silently downloading the whole remote file — which
 * would silently defeat the entire point of Option B (and OOM on long
 * videos / 4K streams).
 */
async function fetchRange(url, start, end) {
  const expectedSize = end - start + 1;
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });

  if (res.status !== 206) {
    // Some CDN edges/misconfigured responses ignore Range and return the
    // whole file as 200. Bail out loudly rather than silently downloading GBs.
    throw new Error(
      `Server tidak balas 206 Partial Content untuk bytes=${start}-${end} (dapet HTTP ${res.status}). ` +
      `Kemungkinan Range header di-ignore — abort supaya gak ke-download full file diam-diam.`
    );
  }

  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);

  // Sanity check: body shouldn't wildly exceed what we requested (small slack
  // for off-by-one edge cases at EOF, but not e.g. 100x bigger).
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

    // Need both, and the whole sidx box must be inside what we fetched
    if (moovBox && sidxBox && sidxBox.end <= buf.length) {
      const sidxBuf = buf.slice(sidxBox.start, sidxBox.end);
      const sidxHeaderSize = sidxBuf.readUInt32BE(0) === 1 ? 16 : 8;
      const sidxIndex = parseSidx(sidxBuf, sidxHeaderSize, sidxBox.end);

      // Init segment = everything before the sidx box (ftyp + moov + free/etc)
      const initSegment = buf.slice(0, sidxBox.start);

      return { initSegment, sidxIndex };
    }

    chunkSize *= 2; // grow and retry
  }

  throw new Error('Tidak ketemu moov/sidx dalam batas probe 30MB (stream mungkin bukan fragmented mp4)');
}

/** Pick sidx segments covering [startSec, endSec] with small padding for keyframe safety. */
function selectCoveringSegments(sidxIndex, startSec, endSec) {
  const paddedStart = Math.max(0, startSec - SEGMENT_PADDING_SEC);
  const paddedEnd = endSec + SEGMENT_PADDING_SEC;

  const covering = sidxIndex.segments.filter(s => s.timeEnd > paddedStart && s.timeStart < paddedEnd);

  if (!covering.length) {
    throw new Error(`Tidak ada segmen sidx yang overlap rentang waktu ${startSec}-${endSec}s`);
  }

  return { byteStart: covering[0].byteStart, byteEnd: covering[covering.length - 1].byteEnd };
}

/** Download just the needed portion of one DASH stream and write it as a local fragmented-mp4. */
async function downloadStreamSegment(url, startSec, endSec, outPath) {
  const { initSegment, sidxIndex } = await probeInitAndSidx(url);
  const { byteStart, byteEnd } = selectCoveringSegments(sidxIndex, startSec, endSec);
  const segmentBuf = await fetchRange(url, byteStart, byteEnd);

  const fd = fs.openSync(outPath, 'w');
  fs.writeSync(fd, initSegment);
  fs.writeSync(fd, segmentBuf);
  fs.closeSync(fd);
}

/** Mux the local video+audio fragments and cut precisely with LOCAL ffmpeg (fast, exact, no network). */
function muxAndTrimLocal(videoPath, audioPath, startSec, endSec, outPath) {
  return new Promise((resolve, reject) => {
    // TAHAP 1: Mux file fragment (video+audio) menjadi MP4 utuh yang punya index global (stbl).
    // Kita biarkan timestamp-nya utuh (tidak di-reset) agar sinkronisasinya tetap absolut.
    const tempMuxPath = outPath + '.tmp_mux.mp4';
    const muxArgs = [
      '-y',
      '-i', videoPath,
      '-i', audioPath,
      '-map', '0:v:0', '-map', '1:a:0?', // a:0? supaya kalau audio kosong gak langsung crash
      '-c', 'copy',
      tempMuxPath
    ];

    const procMux = spawn(toolPaths.ffmpeg, muxArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let muxError = '';
    procMux.stderr.on('data', (d) => { muxError += d.toString(); });

    procMux.on('close', (code1) => {
      if (code1 !== 0 || !fs.existsSync(tempMuxPath)) {
        return reject(new Error(`Tahap 1 (Mux) gagal (code ${code1}): ${muxError.slice(-500)}`));
      }

      // TAHAP 2: Setelah punya index global, kita potong presisi pakai input seeking!
      // Karena file ini sekarang MP4 normal, ffmpeg akan otomatis mencari I-frame terdekat 
      // SEBELUM startSec, dan mempertahankannya (tidak glitch).
      const trimArgs = [
        '-y',
        '-ss', String(startSec), '-to', String(endSec),
        '-i', tempMuxPath,
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        outPath
      ];

      const procTrim = spawn(toolPaths.ffmpeg, trimArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let trimError = '';
      procTrim.stderr.on('data', (d) => { trimError += d.toString(); });

      procTrim.on('close', (code2) => {
        // Hapus file temp mux
        try { fs.existsSync(tempMuxPath) && fs.unlinkSync(tempMuxPath); } catch (_) {}
        
        if (code2 === 0 && fs.existsSync(outPath)) {
          resolve(outPath);
        } else {
          reject(new Error(`Tahap 2 (Trim) gagal (code ${code2}): ${trimError.slice(-500)}`));
        }
      });
      procTrim.on('error', (err) => reject(new Error(`Gagal tahap trim: ${err.message}`)));
    });
    
    procMux.on('error', (err) => reject(new Error(`Gagal tahap mux: ${err.message}`)));
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
 * @returns {Promise<{success:boolean, message:string, status:string, filePath:string}>}
 */
async function remoteTrimByteRange(url, formatSelector, start, end, downloadDir, title, cookieArgs, onProgress) {
  const emit = (percent, status) => onProgress && onProgress({ progress: percent, speed: null, eta: null, status });

  const tmpDir = path.join(downloadDir, '.tmp_rangetrim');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const startSec = parseFloat(start);
  const endSec = parseFloat(end);
  const stamp = Date.now();
  const videoTmp = path.join(tmpDir, `v_${stamp}.mp4`);
  const audioTmp = path.join(tmpDir, `a_${stamp}.m4a`);
  const outPath = path.join(downloadDir, `${sanitizeFilename(title)}_trim_${start}_${end}.mp4`);

  try {
    emit(2, 'Mendapatkan URL stream langsung...');
    const directUrls = await getDirectUrls(url, formatSelector, cookieArgs);
    if (directUrls.length < 2) {
      throw new Error('Format terpilih tidak menghasilkan stream video+audio terpisah (kemungkinan format progresif/muxed)');
    }
    const [videoUrl, audioUrl] = directUrls;

    emit(10, 'Membaca index segmen video (sidx)...');
    await downloadStreamSegment(videoUrl, startSec, endSec, videoTmp);
    emit(45, 'Potongan video ter-download via byte-range');

    emit(50, 'Membaca index segmen audio (sidx)...');
    await downloadStreamSegment(audioUrl, startSec, endSec, audioTmp);
    emit(80, 'Potongan audio ter-download via byte-range');

    emit(85, 'Menggabungkan & memotong secara lokal (ffmpeg)...');
    await muxAndTrimLocal(videoTmp, audioTmp, startSec, endSec, outPath);

    emit(100, 'Selesai');
    return { success: true, message: 'Download selesai (remote byte-range trim)', status: 'Selesai', filePath: outPath };
  } finally {
    [videoTmp, audioTmp].forEach(f => {
      try { fs.existsSync(f) && fs.unlinkSync(f); } catch (_) { /* ignore cleanup errors */ }
    });
  }
}

module.exports = { remoteTrimByteRange, getDirectUrls, probeInitAndSidx };
