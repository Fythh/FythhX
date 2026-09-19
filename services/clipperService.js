// services/clipperService.js
// Implements heatmap scanning, video info fetching, clipping, and dependency checks.
// Uses built‑in https, child_process, fs and utils/toolPaths.

const https = require('https');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { config } = require('../config/config');
const toolPaths = require('../utils/toolPaths');
const { getCookieArgs } = require('./ytDlpService');
const { remoteTrimByteRange } = require('./rangeDownloader');

const activeProcesses = new Map(); // jobId -> Set<ChildProcess>

function registerProcess(jobId, proc) {
  if (!jobId) return;
  if (!activeProcesses.has(jobId)) activeProcesses.set(jobId, new Set());
  activeProcesses.get(jobId).add(proc);
  proc.on('close', () => {
    if (activeProcesses.has(jobId)) activeProcesses.get(jobId).delete(proc);
  });
}

function cancelJobProcesses(jobId) {
  if (activeProcesses.has(jobId)) {
    for (const proc of activeProcesses.get(jobId)) {
      try { proc.kill('SIGKILL'); } catch (e) {}
    }
    activeProcesses.delete(jobId);
  }
}


/** Helper: perform HTTPS GET and collect response */
function httpsGet(options) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Extract YouTube video ID from URL */
function extractVideoId(url) {
  try {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be' || parsed.hostname === 'www.youtu.be') {
      return parsed.pathname.slice(1);
    }
    if (parsed.hostname === 'youtube.com' || parsed.hostname === 'www.youtube.com') {
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
      if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/')[2];
      if (parsed.pathname.startsWith('/live/')) return parsed.pathname.split('/')[2];
      if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/')[2];
    }
    return null;
  } catch (e) {
    return null;
  }
}

const heatmapCache = new Map();

/** Scan heatmap for a given video ID */
function scanHeatmap(videoId) {
  return new Promise((resolve, reject) => {
    if (heatmapCache.has(videoId)) {
      return resolve(heatmapCache.get(videoId));
    }
    const options = {
      hostname: 'www.youtube.com',
      path: `/watch?v=${videoId}`,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    };
    httpsGet(options)
      .then((html) => {
        const match = html.match(/\"markers\"\s*:\s*(\[.*?\])\s*,\s*\"?markersMetadata\"?/s);
        if (!match) {
          // If not found in regex, maybe it has no heatmap or we got rate limited.
          return resolve([]);
        }
        try {
          const markers = JSON.parse(match[1].replace(/\\\"/g, '"'));
          const results = markers
            .map((m) => m.heatMarkerRenderer || m)
            .filter((m) => parseFloat(m.intensityScoreNormalized || 0) >= 0.40)
            .map((m) => ({
              start: parseFloat(m.startMillis) / 1000,
              duration: Math.min(parseFloat(m.durationMillis) / 1000, 60),
              score: parseFloat(m.intensityScoreNormalized),
            }))
            .sort((a, b) => b.score - a.score);
          if (results.length > 0) {
            heatmapCache.set(videoId, results);
          }
          resolve(results);
        } catch (e) {
          resolve([]);
        }
      })
      .catch(reject);
  });
}

/** Get basic video info (title, thumbnail, uploader, duration) */
function getVideoInfo(videoId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.youtube.com',
      path: `/watch?v=${videoId}`,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    };
    httpsGet(options)
      .then((html) => {
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        const thumbMatch = html.match(/\"thumbnailUrl\"\s*:\s*\[\s*\"([^\"]+)\"/i);
        const durationMatch = html.match(/\"lengthSeconds\"\s*:\s*\"?(\d+)\"?/i);
        const uploaderMatch = html.match(/\"ownerChannelName\"\s*:\s*\"([^\"]+)\"/i);
        resolve({
          title: titleMatch ? titleMatch[1].replace(' - YouTube', '').trim() : null,
          thumbnail: thumbMatch ? thumbMatch[1] : null,
          uploader: uploaderMatch ? uploaderMatch[1] : null,
          duration: durationMatch ? parseInt(durationMatch[1], 10) : null,
        });
      })
      .catch(reject);
  });
}

/** Check required Python dependencies */
function checkPythonDeps() {
  return new Promise((resolve) => {
    const result = { python: false, fasterWhisper: false, ffmpeg: false, ytdlp: false };
    // Check python availability
    const py = spawn('where', ['python']);
    py.on('close', (code) => {
      result.python = code === 0;
      if (result.python) {
        // Check faster-whisper import
        const imp = spawn('python', ['-c', 'import faster_whisper']);
        imp.on('close', (c) => {
          result.fasterWhisper = c === 0;
          // Check ffmpeg & yt-dlp via toolPaths helper
          result.ffmpeg = toolPaths.isAvailable('ffmpeg');
          result.ytdlp = toolPaths.isAvailable('yt-dlp');
          resolve(result);
        });
      } else {
        result.ffmpeg = toolPaths.isAvailable('ffmpeg');
        result.ytdlp = toolPaths.isAvailable('yt-dlp');
        resolve(result);
      }
    });
  });
}

// Helper to group words into max_words chunks
function groupWords(wordsArray, maxWords) {
  maxWords = Number(maxWords) || 3;
  const data = [];
  for (let i = 0; i < wordsArray.length; i += maxWords) {
    const chunk = wordsArray.slice(i, i + maxWords);
    if (chunk.length > 0) {
      data.push({
        start: chunk[0].start,
        end: chunk[chunk.length - 1].end,
        text: chunk.map(w => w.word.trim()).join(' ')
      });
    }
  }
  return data;
}

// Helper to parse VTT into words array for Cloudflare
function parseVttTime(timeStr) {
  const parts = timeStr.split(':');
  let seconds = 0;
  if (parts.length === 3) {
    seconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    seconds = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return seconds;
}

function parseVttToWords(vttString) {
  const lines = vttString.split('\n');
  const words = [];
  let currentStart = 0;
  let currentEnd = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes('-->')) {
      const parts = line.split('-->');
      currentStart = parseVttTime(parts[0].trim());
      currentEnd = parseVttTime(parts[1].trim());
    } else if (line && !line.includes('WEBVTT') && !line.match(/^\d+$/)) {
      const text = line.replace(/<[^>]+>/g, '').trim();
      if (text) {
         const tokens = text.split(/\s+/);
         const dur = currentEnd - currentStart;
         const tokenDur = dur / tokens.length;
         tokens.forEach((t, idx) => {
            words.push({
               word: t,
               start: currentStart + (idx * tokenDur),
               end: currentStart + ((idx + 1) * tokenDur)
            });
         });
      }
    }
  }
  return words;
}

// Helper to transcribe audio using External APIs (Groq or Cloudflare)
function transcribeAudioAPI(engine, model, fileData, opts, onLog) {
  return new Promise((resolve, reject) => {
    if (engine === 'groq') {
      if (onLog) onLog('[API] Mengirim audio ke Groq API...');
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      
      let postData = [];
      // Model field
      postData.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model || 'whisper-large-v3-turbo'}\r\n`));
      // Timestamp granularities field
      postData.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nword\r\n`));
      // Response format
      postData.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`));
      // File field
      postData.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`));
      postData.push(fileData);
      postData.push(Buffer.from(`\r\n--${boundary}--\r\n`));
      
      const payload = Buffer.concat(postData);
      
      const reqOpts = {
        hostname: 'api.groq.com',
        path: '/openai/v1/audio/transcriptions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${opts.groqApiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': payload.length
        }
      };
      
      const req = https.request(reqOpts, (res) => {
        let respData = '';
        res.on('data', chunk => respData += chunk);
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`Groq API Error: ${respData}`));
          try {
            const parsed = JSON.parse(respData);
            if (parsed.words && parsed.words.length > 0) {
               resolve(groupWords(parsed.words, opts.maxWords || 3));
            } else {
               // Fallback if no words array
               resolve([{ start: 0, end: 5, text: parsed.text || "" }]);
            }
          } catch (e) {
            reject(new Error(`Failed to parse Groq response: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();

    } else if (engine === 'cloudflare') {
      if (onLog) onLog('[API] Mengirim audio ke Cloudflare Workers AI...');
      const reqOpts = {
        hostname: 'api.cloudflare.com',
        path: `/client/v4/accounts/${opts.cfAccountId}/ai/run/${model || '@cf/openai/whisper-large-v3-turbo'}`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${opts.cfApiToken}`,
          'Content-Type': 'audio/wav',
          'Content-Length': fileData.length
        }
      };
      const req = https.request(reqOpts, (res) => {
        let respData = '';
        res.on('data', chunk => respData += chunk);
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`Cloudflare API Error: ${respData}`));
          try {
            const parsed = JSON.parse(respData);
            if (parsed.success && parsed.result) {
               const resData = parsed.result;
               if (resData.words && resData.words.length > 0) {
                 resolve(groupWords(resData.words, opts.maxWords || 3));
               } else if (resData.vtt) {
                 const parsedWords = parseVttToWords(resData.vtt);
                 if (parsedWords.length > 0) {
                   resolve(groupWords(parsedWords, opts.maxWords || 3));
                 } else {
                   resolve([{ start: 0, end: 5, text: resData.text || "" }]);
                 }
               } else {
                 resolve([{ start: 0, end: 5, text: resData.text || "" }]);
               }
            } else {
               reject(new Error(`Cloudflare failed: ${JSON.stringify(parsed.errors)}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse Cloudflare response: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.write(fileData);
      req.end();
    } else {
      reject(new Error(`Unsupported engine: ${engine}`));
    }
  });
}

const processClip = (opts) => {
  const { videoId, segment, outputDir, cropMode, facecamPos, ratio, subtitle, subtitleEngine, groqApiKey, cfAccountId, cfApiToken, whisperModel, font, color, textCase, watermark, padding, jobId, deps, onLog, maxWords, letterSpacing, resolutionHeight } = opts;

  return new Promise((resolve, reject) => {
    // Prepare output filenames
    const tempFile = path.join(outputDir, `temp_${segment.start}_${Math.random().toString(36).substring(2, 6)}.mp4`);
    const outFile = path.join(outputDir, `clip_${segment.start}.mp4`);

    const startSec = Math.max(0, segment.start - padding);
    const endSec = segment.start + segment.duration + padding;
    const duration = endSec - startSec;
    
    const resVal = opts.resolution || '1080';

    // Check if full video is already downloaded locally (Fast Path)
    const downloadDir = config.paths.downloads;
    let localSource = null;
    if (fs.existsSync(downloadDir)) {
      const files = fs.readdirSync(downloadDir);
      for (const f of files) {
        if (f.endsWith('.mp4') && !f.includes('_trim_') && f.includes(`[${videoId}]`)) {
          localSource = path.join(downloadDir, f);
          break;
        }
      }
    }

    const executeYtDlp = async () => {
      if (onLog) onLog(`[System] Mendownload segmen dari YouTube: ${startSec}s - ${endSec}s (Res: ${resVal})...`);
      const ytDlpService = require('./ytDlpService');
      
      const isLegacy = resVal.match(/^\d+$/) && ['1080', '720', '480', '1440', '2160'].includes(resVal);
      const quality = isLegacy ? 'best' : resVal;
      const qualityHeight = isLegacy ? resVal : '1080';
      
      try {
        let lastLog = 0;
        const result = await ytDlpService.downloadMedia(
          `https://www.youtube.com/watch?v=${videoId}`,
          'mp4',
          quality,
          qualityHeight,
          outputDir,
          (prog) => {
             if (prog.progress) {
                 const now = Date.now();
                 if (now - lastLog > 2000 && onLog) {
                     onLog(`[yt-dlp] Downloading segment... ${prog.progress.toFixed(1)}%`);
                     lastLog = now;
                 }
             }
          },
          startSec,
          endSec,
          videoId,
          ''
        );
        
        if (result && result.filePath && fs.existsSync(result.filePath)) {
           if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
           fs.renameSync(result.filePath, tempFile);
        } else {
           throw new Error("File hasil download tidak ditemukan.");
        }
      } catch (err) {
         throw new Error(`Yt-dlp trim gagal: ${err.message}`);
      }
    };

    const executeLocalTrim = () => {
      return new Promise((res, rej) => {
        if (onLog) onLog(`[System] Fast Path: Mengekstrak segmen dari video lokal...`);
        
        const ffmpegArgs = [
          '-y',
          '-ss', String(startSec),
          '-to', String(endSec),
          '-i', localSource,
          '-c', 'copy',
          tempFile
        ];
        
        const proc = spawn(toolPaths.ffmpeg, ffmpegArgs);
        if (jobId) registerProcess(jobId, proc);
        
        proc.on('close', (code) => {
          if (code !== 0 || !fs.existsSync(tempFile)) {
            return rej(new Error('Local extract failed'));
          }
          res();
        });
      });
    };

    // Run either Local Fast Path or Remote yt-dlp
    const extractPromise = localSource ? executeLocalTrim() : executeYtDlp();

    extractPromise.then(() => {
      if (onLog) onLog(`[System] Segmen berhasil didownload/diekstrak. Memulai rendering efek...`);
      
      // Build ffmpeg filter based on cropMode & ratio
      const baseRes = Number(resolutionHeight) || 1080;
      let outW = null, outH = null;
      if (ratio === '9:16') {
        outW = baseRes;
        outH = Math.round(baseRes * (16/9));
      } else if (ratio === '1:1') {
        outW = baseRes;
        outH = baseRes;
      } else if (ratio === '16:9') {
        outH = baseRes;
        outW = Math.round(baseRes * (16/9));
      }
      
      // nvenc strictly requires both width and height to be even numbers
      if (outW % 2 !== 0) outW += 1;
      if (outH % 2 !== 0) outH += 1;
      let filter = '';
      if (outW && outH) {
        if (ratio === '9:16' && (cropMode === 'split_left' || cropMode === 'split_right' || cropMode === 'split_right_mid' || cropMode === 'split_left_mid')) {
          // --- [DYNAMIC CUSTOM PAN & ZOOM FFMPEG RENDER - Source Based Crop] ---
          // Pendekatan: crop langsung dari source 1920x1080 → scale ke output
          // Sama persis dengan CSS applyCustom, tidak bergantung container pixel size
          const iw = 1920, ih = 1080;
          const gZ = opts.gameZoom != null ? parseFloat(opts.gameZoom) : 216;
          const gX = opts.gameX   != null ? parseFloat(opts.gameX)    : 50;
          const gY = opts.gameY   != null ? parseFloat(opts.gameY)    : 50;
          console.log('[CLIPPER OPTS] game:', {gZ, gX, gY}, 'cam:', {cZ_raw: opts.camZoom, cX_raw: opts.camX, cY_raw: opts.camY});

          // srcCrop(Z,X,Y,outW,outH): hitung crop source + scale ke output
          // Z=zoom%, X=0-100 (horizontal), Y=0-100 (vertical)
          // Di Z=100: video pas muat di output (Math.min scale = letterbox)
          // Di Z>100: zoom in → sumber lebih kecil yang diambil
          const srcCrop = (Z, X, Y, outW, outH) => {
            const zoom = Z / 100;
            // S = scale factor kalau video fit-inside outW x outH
            const S = Math.min(outW / iw, outH / ih);
            // Berapa piksel source yang keliatan di satu dimensi
            // = container_size / (S * zoom)
            const srcW = Math.min(iw, 2 * Math.round((outW / (S * zoom)) / 2));
            const srcH = Math.min(ih, 2 * Math.round((outH / (S * zoom)) / 2));
            // Offset source (dari mana mulai crop)
            const maxOffX = Math.max(0, iw - srcW);
            const maxOffY = Math.max(0, ih - srcH);
            const srcX = 2 * Math.round((maxOffX * (X / 100)) / 2);
            const srcY = 2 * Math.round((maxOffY * (Y / 100)) / 2);
            // Clamp aman
            const cX = Math.min(srcX, maxOffX);
            const cY = Math.min(srcY, maxOffY);
            const cW = Math.max(2, srcW);
            const cH = Math.max(2, srcH);
            // crop source → scale ke output
            // force_original_aspect_ratio=decrease + pad untuk handle black bar
            return `crop=${cW}:${cH}:${cX}:${cY},scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2`;
          };

          // === GAMEPLAY ===
          const topH = Math.max(2, 2 * Math.round((outH * 0.684) / 2));
          const topW = Math.max(2, 2 * Math.round(outW / 2));
          const topFilter = srcCrop(gZ, gX, gY, topW, topH);

          // === FACECAM ===
          let defCX = 50, defCY = 100;
          if      (cropMode === 'split_left_mid')  { defCX = 0;   defCY = 50;  }
          else if (cropMode === 'split_right_mid') { defCX = 100; defCY = 50;  }
          else if (cropMode === 'split_right')     { defCX = 100; defCY = 100; }
          else                                     { defCX = 0;   defCY = 100; }

          const cZ = opts.camZoom != null ? parseFloat(opts.camZoom) : 220;
          const cX = opts.camX    != null ? parseFloat(opts.camX)    : defCX;
          const cY = opts.camY    != null ? parseFloat(opts.camY)    : defCY;

          const botH = Math.max(2, 2 * Math.round((outH - topH) / 2));
          const botW = Math.max(2, 2 * Math.round(outW / 2));
          const botFilter = srcCrop(cZ, cX, cY, botW, botH);

          const stackOrder = facecamPos === 'top' ? '[bottom][top]vstack' : '[top][bottom]vstack';
          filter = `[0:v]split=2[s1][s2];[s1]${topFilter}[top];[s2]${botFilter}[bottom];${stackOrder}`;
          console.log('[FFMPEG FILTER]', filter);

        } else if (cropMode === 'fit') {
          filter = `scale='trunc(min(${outW},iw*sar*${outH}/ih)/2)*2':'trunc(min(${outH},ih*${outW}/(iw*sar))/2)*2',pad=${outW}:${outH}:-1:-1:color=black,setsar=1`;
        } else if (cropMode === 'default' || ratio !== '9:16') {
          filter = `scale='if(gte(a,${outW}/${outH}),-2,${outW})':'if(gte(a,${outW}/${outH}),${outH},-2)',setsar=1,crop=${outW}:${outH}:(iw-${outW})/2:(ih-${outH})/2`;
        }

      }

      // Fix: beneran nge-test encode 1 frame pake h264_nvenc, bukan cuma cek nama di list.
      // Di PC tanpa GPU Nvidia (iGPU only), nama itu tetap muncul tapi eksekusi gagal
      // ("Cannot load nvcuda.dll") → render mati total, 0 byte output tanpa fallback.
      // Hasil test di-cache di global biar ga nge-test ulang tiap segment.
      let encoder = 'libx264';
      let preset = 'ultrafast';
      if (global.__fytxNvencUsable === undefined) {
        try {
          const testOut = path.join(os.tmpdir(), `fytx_nvenc_test_${Date.now()}.mp4`);
          require('child_process').execSync(
            `"${toolPaths.ffmpeg}" -y -f lavfi -i color=c=black:s=64x64:d=0.1 -c:v h264_nvenc -f mp4 "${testOut}"`,
            { stdio: 'ignore', timeout: 8000 }
          );
          global.__fytxNvencUsable = fs.existsSync(testOut) && fs.statSync(testOut).size > 0;
          if (fs.existsSync(testOut)) fs.unlinkSync(testOut);
        } catch (e) {
          global.__fytxNvencUsable = false;
        }
        console.log(`[Encoder] NVENC hardware test: ${global.__fytxNvencUsable ? 'OK, pakai GPU' : 'gagal, fallback ke CPU (libx264)'}`);
      }
      if (global.__fytxNvencUsable) {
        encoder = 'h264_nvenc';
        preset = 'p4';
      }

      const baseFfmpegArgs = ['-y', '-i', tempFile, '-c:v', encoder, '-preset', preset, '-b:v', '4M', '-c:a', 'aac', '-b:a', '128k'];

      // Fix: kalau engine-nya API eksternal (Groq/Cloudflare), gak perlu faster-whisper lokal.
      // Sebelumnya doSubtitle mensyaratkan deps.fasterWhisper apapun engine-nya, jadi
      // subtitle diam-diam di-skip meski API key sudah diisi → 0KiB subtitle di output.
      const usingExternalSttApi = subtitleEngine === 'groq' || subtitleEngine === 'cloudflare';
      const doSubtitle = subtitle && (usingExternalSttApi || (deps && deps.fasterWhisper));
      const doWatermark = watermark && watermark.enabled && watermark.text;

      if (doSubtitle || doWatermark) {
        // Prepare to run python whisper if subtitle is needed
        let p = Promise.resolve();
        
        if (doSubtitle) {
          p = new Promise((resolve, reject) => {
            const pythonScript = path.join(__dirname, '..', 'scripts', 'generate_subtitle.py');
            const jsonPath = tempFile.replace('.mp4', '.json');
            const wavFile = tempFile.replace('.mp4', '.wav');
            
            if (onLog) onLog(`[System] Mengekstrak audio bersih untuk akurasi AI Whisper...`);
            const ffmpegProc = spawn(toolPaths.ffmpeg, ['-y', '-i', tempFile, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', wavFile]);
            
            ffmpegProc.on('close', () => {
              if (subtitleEngine === 'groq' || subtitleEngine === 'cloudflare') {
                if (onLog) onLog(`[API] Membaca file audio untuk dikirim ke ${subtitleEngine}...`);
                let fileData;
                try {
                  fileData = fs.readFileSync(wavFile);
                } catch(e) {
                  return reject(new Error('Gagal membaca file audio: ' + e.message));
                }
                
                transcribeAudioAPI(subtitleEngine, whisperModel, fileData, opts, onLog)
                  .then(data => {
                    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
                    resolve(jsonPath);
                  })
                  .catch(err => {
                    if (onLog) onLog(`[API Error] ${err.message}`);
                    reject(err);
                  })
                  .finally(() => {
                    if (fs.existsSync(wavFile)) fs.unlinkSync(wavFile);
                  });
              } else {
                const pyArgs = [pythonScript, fs.existsSync(wavFile) ? wavFile : tempFile, jsonPath, whisperModel || 'small', String(maxWords || 3)];
                const pyProcess = spawn('python', pyArgs, { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
                if (jobId) registerProcess(jobId, pyProcess);
                pyProcess.stdout.on('data', (d) => {
                  if (onLog) onLog(`[Whisper] ${d.toString().trim()}`);
                });
                let lastLogTime = 0;
                pyProcess.stderr.on('data', (d) => {
                  const str = d.toString();
                  if (str.includes('%|') || str.includes('Downloading')) {
                     const now = Date.now();
                     if (now - lastLogTime > 1500) {
                        const lines = str.split('\r');
                        const latest = lines[lines.length - 1] || lines[lines.length - 2] || str;
                        if (onLog) onLog(`[Download Model AI] ${latest.trim()}`);
                        lastLogTime = now;
                     }
                  } else {
                     if (onLog && str.trim()) onLog(`[Whisper] ${str.trim()}`);
                  }
                });
                pyProcess.on('close', (c) => {
                  if (fs.existsSync(wavFile)) fs.unlinkSync(wavFile);
                  if (c !== 0) return reject(new Error('Python whisper failed with code ' + c));
                  resolve(jsonPath);
                });
              }
            });
          });
        }

        p.then((jsonPath) => {
          let words = [];
          if (doSubtitle && jsonPath && fs.existsSync(jsonPath)) {
            words = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
          }

          const prY = (ratio === '9:16' || ratio === 'original') ? 1920 : 1080;
          const prX = (ratio === '9:16' || ratio === 'original') ? 1080 : 1920;
          const fontScale = 1;

          const fontSizeStr = String(Math.round(Number(opts.fontSize) || 70));
          const outCol = opts.outlineColor || '&H000000&';
          let useLayers = false;
          let blurAmount = 0;

          const align = 5; // 5 = Middle Center in ASS
          
          const cPrim = '&H00' + color.substring(2, 8);
          const cOut = '&H00' + outCol.substring(2, 8);

          let styles = `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n`;
          let events = `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

          const ls = opts.letterSpacing || 0;
          
          // FONT ART STYLES
          if (opts.fontArt === 'neon') {
             const artFont = 'Anton';
             const artPrim = '&H00FFFFFF';
             const artOut = '&H00DE00FF'; // Neon pink outline
             styles += `Style: Glow,${artFont},${fontSizeStr},${artOut},&H000000FF,${artOut},&H00000000,-1,0,0,0,100,100,${ls},0,1,8,0,${align},0,0,0,1\n`;
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,${ls},0,1,0,0,${align},0,0,0,1\n`;
             useLayers = true;
             blurAmount = Math.max(2, Math.round(15 * fontScale));
          } else if (opts.fontArt === 'yellow') {
             const artFont = 'Lilita One';
             const artPrim = '&H003BEBFF'; // #ffeb3b Yellow
             const artOut = '&H00000000'; // Black
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,${artOut},${artOut},-1,0,0,0,100,100,${ls},0,1,4,5,${align},0,0,0,1\n`;
          } else if (opts.fontArt === 'retro') {
             const artFont = 'Mochiy Pop P One';
             const artPrim = '&H00FEAC4F'; // #4facfe 
             const artOut = '&H00FEF200'; // #00f2fe
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,${artOut},&H00000000,-1,-1,0,0,100,100,${ls},0,1,2,6,${align},0,0,0,1\n`;
          } else if (opts.fontArt === 'outline') {
             const artFont = 'Bebas Neue';
             const artPrim = '&H00FFFFFF'; 
             const artOut = '&H00000000';
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,${artOut},${artOut},-1,0,0,0,100,100,2,0,1,5,6,${align},0,0,0,1\n`;
          } else if (opts.fontArt === 'glitch') {
             const artFont = 'Rubik Glitch';
             const artPrim = '&H00FFFFFF'; 
             styles += `Style: Glow,${artFont},${fontSizeStr},&H00C100FF,&H000000FF,&H00000000,&H00C100FF,-1,0,0,0,100,100,${ls},0,1,0,3,${align},0,0,0,1\n`;
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,&H00000000,&H00F9FF00,-1,0,0,0,100,100,${ls},0,1,0,-3,${align},0,0,0,1\n`;
             useLayers = true;
          } else if (opts.fontArt === 'pixel') {
             const artFont = 'Press Start 2P';
             const artPrim = '&H00FFFFFF'; 
             const artOut = '&H00000000';
             const pSize = String(Math.round(Number(fontSizeStr) * 0.8));
             styles += `Style: Core,${artFont},${pSize},${artPrim},&H000000FF,&H00000000,${artOut},-1,0,0,0,100,100,${ls},0,1,0,5,${align},0,0,0,1\n`;
          } else if (opts.fontArt === 'graffiti') {
             const artFont = 'Sedgwick Ave Display';
             const artPrim = '&H00FFFFFF'; 
             const artOut = '&H00000000';
             const artShad = '&H000000E6'; // Red shadow #e60000 -> BGR -> E60000
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,${artOut},${artShad},-1,0,0,0,100,100,${ls},0,1,3,4,${align},0,0,0,1\n`;
          } else if (opts.fontArt === 'halloween') {
             const artFont = 'Creepster';
             const artPrim = '&H000000FF'; // Red
             const artOut = '&H0000008A'; // Dark Red Glow
             styles += `Style: Glow,${artFont},${fontSizeStr},${artOut},&H000000FF,${artOut},&H00000000,-1,0,0,0,100,100,${ls},0,1,8,0,${align},0,0,0,1\n`;
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,${ls},0,1,0,0,${align},0,0,0,1\n`;
             useLayers = true;
             blurAmount = Math.max(2, Math.round(10 * fontScale));
          } else if (opts.fontArt === 'bubblegum') {
             const artFont = 'Comic Neue';
             const artPrim = '&H00C1B6FF'; // Light pink #ffb6c1 -> C1B6FF
             const artOut = '&H00B469FF'; // Hot pink #ff69b4 -> B469FF
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,${artOut},${artOut},-1,0,0,0,100,100,${ls},0,1,3,3,${align},0,0,0,1\n`;
          } else if (opts.fontArt === 'cinematic') {
             const artFont = 'Montserrat';
             const artPrim = '&H00FFFFFF'; 
             const artOut = '&H00000000';
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,&H00000000,${artOut},-1,0,0,0,100,100,8,0,1,0,4,${align},0,0,0,1\n`;
          } else if (opts.fontArt === 'impact') {
             const artFont = 'Bangers';
             const artPrim = '&H000045FF'; // #ff4500 -> 0045FF
             const artOut = '&H00000000'; // Black
             const artShad = '&H0000008B'; // Dark Red #8b0000 -> 00008B
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,${artOut},${artShad},-1,0,0,0,100,100,2,0,1,3,5,${align},0,0,0,1\n`;
          } else if (opts.fontArt === 'marker') {
             const artFont = 'Permanent Marker';
             const artPrim = '&H00000000'; // Black
             const artOut = '&H00FFFFFF'; // White
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,${artOut},${artOut},-1,0,0,0,100,100,${ls},0,1,3,4,${align},0,0,0,1\n`;
          } else if (opts.fontArt === 'cyberpunk') {
             const artFont = 'Orbitron';
             styles += `Style: Glow,${artFont},${fontSizeStr},&H00FFFF00,&H000000FF,&H00FFFF00,&H00000000,-1,0,0,0,100,100,${ls},0,1,6,0,${align},0,0,0,1\n`;
             styles += `Style: Core,${artFont},${fontSizeStr},&H00FFFF00,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,${ls},0,1,0,3,${align},0,0,0,1\n`;
             useLayers = true;
             blurAmount = Math.max(2, Math.round(5 * fontScale));
          } else if (opts.fontArt === 'elegant') {
             const artFont = 'Playfair Display';
             const artPrim = '&H0000D7FF'; 
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,${ls},0,1,0,3,${align},0,0,0,1\n`;
          } else if (opts.fontArt === 'typewriter') {
             const artFont = 'Special Elite';
             const artPrim = '&H1AFFFFFF';
             const artOut = '&H33000000';
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,${artOut},${artOut},-1,0,0,0,100,100,${ls},0,1,1,2,${align},0,0,0,1\n`;
          } else if (opts.fontArt === 'mecha') {
             const artFont = 'Teko';
             const artPrim = '&H00FFFFFF';
             const artOut = '&H000000FF';
             const artShad = '&H0000008B';
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,${artOut},${artShad},-1,0,0,0,100,100,2,0,1,2,4,${align},0,0,0,1\n`;
          } else if (opts.fontArt === 'bloody') {
             const artFont = 'Nosifer';
             const artPrim = '&H0000008B';
             const artOut = '&H000000FF';
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,${artOut},&H00000000,-1,0,0,0,100,100,${ls},0,1,2,3,${align},0,0,0,1\n`;
          } else if (opts.fontArt === 'romantic') {
             const artFont = 'Dancing Script';
             const artPrim = '&H00B469FF';
             const artOut = '&H00FFFFFF';
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,${artOut},&H009314FF,-1,0,0,0,100,100,${ls},0,1,1,3,${align},0,0,0,1\n`;
          } else if (opts.fontArt === 'terminal') {
             const artFont = 'VT323';
             const artPrim = '&H0014FF39';
             styles += `Style: Glow,${artFont},${fontSizeStr},${artPrim},&H000000FF,${artPrim},&H00000000,-1,0,0,0,100,100,${ls},0,1,3,0,${align},0,0,0,1\n`;
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,${ls},0,1,0,2,${align},0,0,0,1\n`;
             useLayers = true;
             blurAmount = Math.max(1, Math.round(3 * fontScale));
          } else if (opts.fontArt === 'varsity') {
             const artFont = 'Graduate';
             const artPrim = '&H00FFFFFF';
             const artOut = '&H008B0000';
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,${artOut},&H00000000,-1,0,0,0,100,100,${ls},0,1,3,3,${align},0,0,0,1\n`;
          } else if (opts.fontArt === 'kids') {
             const artFont = 'Fredoka One';
             const artPrim = '&H00FFFF00';
             const artOut = '&H00FF00FF';
             styles += `Style: Core,${artFont},${fontSizeStr},${artPrim},&H000000FF,${artOut},&H00000000,-1,0,0,0,100,100,${ls},0,1,3,3,${align},0,0,0,1\n`;
          } else {
             // STANDARD STYLING
const blur5 = Math.max(1, Math.round(5 * fontScale));
             const blur4 = Math.max(1, Math.round(4 * fontScale));
             if (opts.outlineType === 'glow') {
                styles += `Style: Glow,${font},${fontSizeStr},${cOut},&H000000FF,${cOut},&H00000000,1,0,0,0,100,100,${ls},0,1,6,0,${align},0,0,0,1\n`;
                styles += `Style: Core,${font},${fontSizeStr},${cPrim},&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,${ls},0,1,0,0,${align},0,0,0,1\n`;
                useLayers = true;
                blurAmount = blur5;
             } else if (opts.outlineType === 'shadow') {
                styles += `Style: Glow,${font},${fontSizeStr},&H00000000,&H000000FF,&H00000000,${cOut},1,0,0,0,100,100,${ls},0,1,0,4,${align},0,0,0,1\n`;
                styles += `Style: Core,${font},${fontSizeStr},${cPrim},&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,${ls},0,1,0,0,${align},0,0,0,1\n`;
                useLayers = true;
                blurAmount = blur4;
             } else if (opts.outlineType === 'stroke_shadow') {
                styles += `Style: Core,${font},${fontSizeStr},${cPrim},&H000000FF,${cOut},${cOut},1,0,0,0,100,100,${ls},0,1,2,2,${align},0,0,0,1\n`;
             } else if (opts.outlineType === 'none') {
                styles += `Style: Core,${font},${fontSizeStr},${cPrim},&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,${ls},0,1,0,0,${align},0,0,0,1\n`;
             } else {
                styles += `Style: Core,${font},${fontSizeStr},${cPrim},&H000000FF,${cOut},&H00000000,1,0,0,0,100,100,${ls},0,1,2,0,${align},0,0,0,1\n`;
             }
          }

          function ts(t) {
             const h = Math.floor(t / 3600);
             const m = Math.floor((t % 3600) / 60);
             const s = Math.floor(t % 60);
             const cs = Math.floor((t % 1) * 100);
             return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
          }

          if (doWatermark) {
            const wmX = Math.round((Number(watermark.posX) || 50) / 100 * prX);
            const wmY = Math.round((Number(watermark.posY) || 20) / 100 * prY);
            const wmSize = String(Math.round((Number(watermark.size) || 40) * fontScale));
            const opacity = Number(watermark.opacity) || 50;
            const alphaDec = Math.round(255 - (opacity / 100 * 255));
            const alphaHex = alphaDec.toString(16).padStart(2, '0').toUpperCase();
            
            // Fix: set endTs to a very large number so watermark never disappears, even if video is longer due to keyframe snap
            const endTs = "9:59:59.00";
            const safeWmText = watermark.text.replace(/[{}]/g, '').replace(/\n/g, '\\N');
            
            styles += `Style: Watermark,${font},${wmSize},&H${alphaHex}FFFFFF,&H${alphaHex}0000FF,&H${alphaHex}000000,&H${alphaHex}000000,1,0,0,0,100,100,0,0,1,1,0,5,0,0,0,1\n`;
            events += `Dialogue: 0,0:00:00.00,${endTs},Watermark,,0,0,0,,{\\pos(${wmX},${wmY})}${safeWmText}\n`;
          }

          const absX = Math.round((Number(opts.posX) || 50) / 100 * prX);
          const absY = Math.round((Number(opts.posY) || 80) / 100 * prY);

          // Pre-process words to prevent timestamps overlapping (fixes cascading delays)
          for (let i = 0; i < words.length - 1; i++) {
             if (words[i].end > words[i+1].start) {
                words[i].end = words[i+1].start;
             }
             if (words[i].end <= words[i].start) {
                words[i].end = words[i].start + 0.1;
             }
          }
          if (words.length > 0) {
             let lastW = words[words.length-1];
             if (lastW.end <= lastW.start) lastW.end = lastW.start + 0.1;
          }

          words.forEach(w => {
            const start = ts(w.start);
            const end = ts(w.end);
            
            let text = w.text.replace(/[{}]/g, '').replace(/\n/g, '\\N');
            if (opts.fontArt === 'outline' || opts.textCase === 'upper') {
               text = text.toUpperCase();
            } else if (opts.textCase === 'lower') {
               text = text.toLowerCase();
            } else if (opts.textCase === 'title') {
               text = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
            }

            // ANIMATION STYLES
            let tags = `\\pos(${absX},${absY})`;
            const baseAnimIn = opts.animIn !== undefined ? parseInt(opts.animIn) : 150;
            const baseAnimOut = opts.animOut !== undefined ? parseInt(opts.animOut) : 150;
            
            // Cap animations to prevent ASS overlap glitches on very fast spoken words
            const durationMs = (w.end - w.start) * 1000;
            const animIn = Math.floor(Math.min(baseAnimIn, Math.max(0, durationMs * 0.4)));
            const animOut = Math.floor(Math.min(baseAnimOut, Math.max(0, durationMs * 0.4)));

            if (opts.animStyle === 'fade') {
               tags += `\\fad(${animIn},${animOut})`;
            } else if (opts.animStyle === 'pop') {
               tags += `\\fad(${animIn},${animOut})\\t(0,${animIn},\\fscx115\\fscy115)\\t(${animIn},${animIn*2},\\fscx100\\fscy100)`;
            } else if (opts.animStyle === 'slideup') {
               const slideDist = Math.round(50 * fontScale);
               tags = `\\move(${absX},${absY + slideDist},${absX},${absY},0,${animIn})\\fad(${animIn},${animOut})`;
            } else if (opts.animStyle === 'slidedown') {
               const slideDist = Math.round(50 * fontScale);
               tags = `\\move(${absX},${absY - slideDist},${absX},${absY},0,${animIn})\\fad(${animIn},${animOut})`;
            } else {
               // No animation, just basic tags
            }

            if (useLayers) {
               events += `Dialogue: 0,${start},${end},Glow,,0,0,0,,{${tags}\\blur${blurAmount}}${text}\n`;
               events += `Dialogue: 1,${start},${end},Core,,0,0,0,,{${tags}}${text}\n`;
            } else {
               events += `Dialogue: 0,${start},${end},Core,,0,0,0,,{${tags}}${text}\n`;
            }
          });

          const assContent = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${prX}\nPlayResY: ${prY}\n\n${styles}\n${events}`;
          const assPath = path.join(outputDir, `subtitle_${segment.start}_${jobId}.ass`);
          fs.writeFileSync(assPath, assContent);

          const assPathFfmpeg = path.relative(process.cwd(), assPath).replace(/\\/g, '/');
          const fontsDirFfmpeg = path.relative(process.cwd(), path.resolve(__dirname, '..', 'fonts')).replace(/\\/g, '/');
          const subFilter = `subtitles=filename='${assPathFfmpeg}':fontsdir='${fontsDirFfmpeg}'`;
          const finalFilter = filter ? `${filter},${subFilter}` : subFilter;
          const finalArgs = baseFfmpegArgs.concat(['-vf', finalFilter, outFile]);
          const ffmpeg = spawn(toolPaths.ffmpeg, finalArgs);
          if (jobId) registerProcess(jobId, ffmpeg);
          ffmpeg.stderr.on('data', (d) => {
            console.log(`[ffmpeg-sub] ${d.toString()}`);
            if (onLog && d.toString().includes('time=')) {
              const match = d.toString().match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
              if (match) onLog(`[FFmpeg] Rendering with Subtitles... ${match[1]}`);
            }
          });
          ffmpeg.on('close', (fc) => {
            if (fc !== 0) return reject(new Error('ffmpeg failed with code ' + fc));
            cleanup();
          });
        }).catch(err => {
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
          reject(err);
        });
      } else {
        if (onLog) onLog('[FFmpeg] Memulai proses render tanpa subtitle...');
        const finalArgs = filter ? baseFfmpegArgs.concat(['-vf', filter, outFile]) : baseFfmpegArgs.concat([outFile]);
        const ffmpeg = spawn(toolPaths.ffmpeg, finalArgs);
        if (jobId) registerProcess(jobId, ffmpeg);
        ffmpeg.stderr.on('data', (d) => {
          console.log(`[ffmpeg] ${d.toString()}`);
          if (onLog && d.toString().includes('time=')) {
            const match = d.toString().match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
            if (match) onLog(`[FFmpeg] Rendering... ${match[1]}`);
          }
        });
        ffmpeg.on('close', (fc) => {
          if (fc !== 0) return reject(new Error('ffmpeg failed with code ' + fc));
          if (onLog) onLog('[FFmpeg] Proses render selesai.');
          cleanup();
        });
      }

      function cleanup() {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        if (onLog) onLog('[System] Cleaning up temporary files...');
        resolve(outFile);
      }
    }).catch(err => {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      if (onLog) onLog(`[Error] proses gagal: ${err.message}`);
      reject(err);
    });
  });
}

module.exports = {
  scanHeatmap,
  getVideoInfo,
  checkPythonDeps,
  extractVideoId,
  processClip,
  cancelJobProcesses,
};


