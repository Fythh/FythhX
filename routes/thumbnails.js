/**
 * Thumbnails Route
 *
 * GET /api/thumbnails/frame?url=...&time=10
 * Extracts a specific frame from a direct video stream URL using FFmpeg on-the-fly.
 *
 * GET /api/thumbnails/sprite?url=...&duration=...&count=...
 * ASYNC sprite generation — responds immediately with status.
 * { status: 'pending', jobId } OR { status: 'done', spriteUrl, ... } OR { status: 'error', error }
 * Client polls the same URL until status is 'done' or 'error'.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');
const toolPaths = require('../utils/toolPaths');
const { getDirectUrls } = require('../services/rangeDownloader');

/**
 * Bangun header Referer/Origin/Cookie buat ffmpeg fetch langsung ke googlevideo,
 * meniru apa yang sudah dilakukan routes/proxy.js. Tanpa ini, googlevideo balikin 403
 * karena ffmpeg cuma kirim User-Agent doang.
 */
function buildFfmpegHeaders(targetUrl) {
  let extra = '';
  try {
    const host = new URL(targetUrl).hostname;
    if (host.includes('youtube.com')) {
      extra += 'Referer: https://www.youtube.com/\r\n';
      extra += 'Origin: https://www.youtube.com\r\n';
    } else if (host.includes('tiktok')) {
      extra += 'Referer: https://www.tiktok.com/\r\n';
      extra += 'Origin: https://www.tiktok.com\r\n';
    }
  } catch (e) {}

  try {
    const cookiesPath = path.join(__dirname, '..', 'cookies.txt');
    if (fs.existsSync(cookiesPath)) {
      const targetHost = new URL(targetUrl).hostname;
      const lines = fs.readFileSync(cookiesPath, 'utf8').split('\n');
      const cookies = [];
      for (const line of lines) {
        if (!line.trim() || line.startsWith('#')) continue;
        const parts = line.split('\t');
        if (parts.length >= 7 && targetHost.includes(parts[0].replace(/^\./, ''))) {
          cookies.push(`${parts[5]}=${parts[6].trim()}`);
        }
      }
      if (cookies.length) extra += `Cookie: ${cookies.join('; ')}\r\n`;
    }
  } catch (e) {}

  return extra;
}

// Folder cache sprite, di-serve static
const SPRITE_DIR = path.join(__dirname, '..', 'cache', 'filmstrips');
if (!fs.existsSync(SPRITE_DIR)) fs.mkdirSync(SPRITE_DIR, { recursive: true });

// Simple in-memory cache: url+time -> jpeg buffer
const thumbCache = new Map();
const MAX_CACHE = 200;

// ─── Async Sprite Job Queue ───────────────────────────────────────────────────
// hash -> { status: 'pending'|'done'|'error', ...meta }
const spriteJobs = new Map();
// Hashes of jobs currently being processed by FFmpeg
const activeJobs = new Set();
// hash -> berapa kali sudah requeue diam-diam setelah error (dibatasi biar gak retry selamanya tanpa lapor ke client)
const requeueCounts = new Map();
const MAX_SILENT_REQUEUES = 2; // total percobaan = MAX_SILENT_REQUEUES x MAX_ATTEMPTS (2 x 3 = 6x coba)

function runSpriteJob(hash, ffmpegCmd, args, outputPath, meta) {
  const MAX_ATTEMPTS = 3;
  let attempt = 0;

  const tryRun = () => {
    attempt++;
    console.log(`[sprite] Job ${hash.substring(0,8)} attempt ${attempt}/${MAX_ATTEMPTS}`);
    const ff = spawn(ffmpegCmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    ff.stderr.on('data', (d) => { stderr += d.toString(); });

    ff.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        spriteJobs.set(hash, { status: 'done', ...meta });
        activeJobs.delete(hash);
        requeueCounts.delete(hash);
        console.log(`[sprite] Job ${hash.substring(0,8)} SUCCESS`);
      } else {
        console.error(`[sprite] Job ${hash.substring(0,8)} attempt ${attempt} failed:`, stderr.slice(-400));
        if (attempt < MAX_ATTEMPTS) {
          const delay = attempt * 2000; // 2s, 4s exponential backoff
          console.log(`[sprite] Retrying job ${hash.substring(0,8)} in ${delay}ms...`);
          setTimeout(tryRun, delay);
        } else {
          spriteJobs.set(hash, { status: 'error', error: 'Gagal generate sprite setelah ' + MAX_ATTEMPTS + ' percobaan' });
          activeJobs.delete(hash);
          console.error(`[sprite] Job ${hash.substring(0,8)} FAILED after ${MAX_ATTEMPTS} attempts`);
        }
      }
    });

    ff.on('error', (err) => {
      spriteJobs.set(hash, { status: 'error', error: err.message });
      activeJobs.delete(hash);
    });
  };

  tryRun();
}

// Cleanup old completed jobs to prevent memory leak (keep last 200)
setInterval(() => {
  if (spriteJobs.size > 200) {
    const toDelete = Array.from(spriteJobs.keys()).slice(0, spriteJobs.size - 200);
    toDelete.forEach(k => spriteJobs.delete(k));
  }
  if (requeueCounts.size > 200) {
    const toDelete = Array.from(requeueCounts.keys()).slice(0, requeueCounts.size - 200);
    toDelete.forEach(k => requeueCounts.delete(k));
  }
}, 60000);

router.get('/debug', (req, res) => {
  res.json({
    activeJobs: Array.from(activeJobs),
    spriteJobs: Object.fromEntries(spriteJobs),
    requeueCounts: Object.fromEntries(requeueCounts)
  });
});

// ─── /thumbnails/frame ────────────────────────────────────────────────────────
router.get('/thumbnails/frame', async (req, res) => {
  const { url: rawUrl, time, videoId } = req.query;

  if (!rawUrl || time === undefined || time === '') {
    return res.status(400).json({ error: 'Missing url or time parameter' });
  }

  const url = await getFreshUrl(rawUrl, videoId);

  // Resolve proxy URL to real URL for FFmpeg in case it's still a proxy URL
  let resolvedUrl = url;
  if (resolvedUrl.includes('/api/proxy')) {
    try {
      const qs = resolvedUrl.includes('?') ? resolvedUrl.split('?')[1] : '';
      const parsed = new URLSearchParams(qs);
      const realUrl = parsed.get('url');
      if (realUrl) resolvedUrl = realUrl;
    } catch (e) {}
  }

  const cacheKey = `${videoId || rawUrl}::${time}`;
  if (thumbCache.has(cacheKey)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Thumb-Cache', 'HIT');
    return res.send(thumbCache.get(cacheKey));
  }

  const ffmpegExe = path.join(__dirname, '..', 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe');
  const ffmpegCmd = fs.existsSync(ffmpegExe) ? ffmpegExe : toolPaths.ffmpeg;

  const ffmpegUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

  let proxyWrappedUrl = `http://127.0.0.1:${process.env.PORT || 8080}/api/proxy?url=${encodeURIComponent(resolvedUrl)}`;

  const args = [
    '-user_agent', ffmpegUA,
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-ss', parseFloat(time).toFixed(3),
    '-i', proxyWrappedUrl,
    '-vframes', '1',
    '-q:v', '3',
    '-vf', 'scale=160:-1',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    'pipe:1'
  ];

  const chunks = [];
  let headersSent = false;
  let killed = false;

  const ffmpegProcess = spawn(ffmpegCmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const ffmpegTimeout = setTimeout(() => {
    if (!killed && !ffmpegProcess.killed) {
      killed = true;
      console.warn('[thumbnail] FFmpeg timeout at', time, '- killing process');
      ffmpegProcess.kill('SIGKILL');
    }
  }, 15000);

  ffmpegProcess.stdout.on('data', (chunk) => { chunks.push(chunk); });
  ffmpegProcess.stderr.on('data', () => {});

  ffmpegProcess.on('error', (err) => {
    console.error('[thumbnail] FFmpeg spawn error:', err.message);
    if (!headersSent) { headersSent = true; res.status(500).json({ error: 'FFmpeg not available' }); }
  });

  ffmpegProcess.on('close', (code) => {
    clearTimeout(ffmpegTimeout);
    if (killed && chunks.length === 0) return;

    const buffer = Buffer.concat(chunks);

    if (code === 0 && buffer.length > 0) {
      if (thumbCache.size >= MAX_CACHE) thumbCache.delete(thumbCache.keys().next().value);
      thumbCache.set(cacheKey, buffer);
      if (!headersSent) {
        headersSent = true;
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('X-Thumb-Cache', 'MISS');
        res.send(buffer);
      }
    } else {
      if (!headersSent) {
        headersSent = true;
        const placeholder = Buffer.from(
          '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
          'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN' +
          'DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
          'MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAA' +
          'AAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/' +
          'aAAwDAQACEQMRAD8AJQAB/9k=', 'base64'
        );
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-cache');
        res.status(200).send(placeholder);
      }
    }
  });

  req.on('close', () => {
    clearTimeout(ffmpegTimeout);
    if (!ffmpegProcess.killed) { killed = true; ffmpegProcess.kill('SIGKILL'); }
  });
});

// ─── /thumbnails/sprite (ASYNC + POLLING) ────────────────────────────────────
// Always returns immediately. Client polls this same endpoint until status === 'done'.
router.get('/thumbnails/sprite', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  try {
    let { url, duration, count, videoId } = req.query;
    if (!url || !duration || !count) {
      return res.status(400).json({ error: 'url, duration, count wajib diisi' });
    }

    if (url.includes('/api/proxy')) {
      try {
        const qs = url.includes('?') ? url.split('?')[1] : '';
        const parsed = new URLSearchParams(qs);
        const realUrl = parsed.get('url');
        if (realUrl) url = realUrl;
      } catch (e) {
        if (url.startsWith('/')) {
          url = `${req.protocol}://${req.get('host')}${url}`;
        }
      }
    }

    const dur = parseFloat(duration);
    const targetCount = Math.min(300, Math.max(1, parseInt(count, 10)));
    const cols = Math.ceil(Math.sqrt(targetCount));
    const rows = Math.ceil(targetCount / cols);
    const actualCount = cols * rows;
    const frameW = 160;
    const frameH = 90;

    // Stable cache key: use videoId so cache survives YouTube URL expiry
    const cacheKey = videoId ? videoId : url;
    const hash = crypto.createHash('md5').update(`${cacheKey}_${dur}_${targetCount}`).digest('hex');
    const filename = `${hash}.jpg`;
    const outputPath = path.join(SPRITE_DIR, filename);
    const spriteUrl = `/filmstrips/${filename}`;

    const meta = {
      spriteUrl, cols, rows,
      frameWidth: frameW, frameHeight: frameH,
      count: actualCount, interval: dur / actualCount
    };

    if (!fs.existsSync(SPRITE_DIR)) {
      fs.mkdirSync(SPRITE_DIR, { recursive: true });
    }

    // 1. File already exists on disk — instant response
    if (fs.existsSync(outputPath)) {
      return res.json({ status: 'done', ...meta });
    }

    // 2. Job already finished in memory (done or error)
    const existingJob = spriteJobs.get(hash);
    if (existingJob && existingJob.status !== 'pending') {
      // If done, also confirm file exists (might have been deleted)
      if (existingJob.status === 'done' && !fs.existsSync(outputPath)) {
        // File was deleted, remove from cache and re-queue below
        spriteJobs.delete(hash);
        activeJobs.delete(hash);
      } else if (existingJob.status === 'error') {
        // Batasi requeue diam-diam. Kalau sudah kepentok limit, JANGAN dihapus —
        // biarkan status 'error' ke-return ke client biar pesan gagal beneran muncul,
        // bukan stuck 'pending' sampai timeout 10 menit.
        const tries = requeueCounts.get(hash) || 0;
        if (tries >= MAX_SILENT_REQUEUES) {
          return res.json(existingJob);
        }
        requeueCounts.set(hash, tries + 1);
        spriteJobs.delete(hash);
        activeJobs.delete(hash);
      } else {
        return res.json(existingJob);
      }
    }

    // 3. Job is already actively running — return pending (dedup)
    if (activeJobs.has(hash)) {
      return res.json({ status: 'pending', jobId: hash, message: 'Sprite sedang diproses di background...' });
    }

    // 4. Start new background job
    // PREVENT CONCURRENCY: Mark job as pending BEFORE awaiting yt-dlp, so subsequent polls return pending immediately
    // instead of spawning multiple yt-dlp instances which crashes the server!
    activeJobs.add(hash);
    spriteJobs.set(hash, { status: 'pending' });
    
    // Fire-and-forget background async IIFE
    setImmediate(async () => {
      try {
        // Tarik URL fresh dulu tepat sebelum ffmpeg jalan. Prioritaskan format non-HLS agar lebih cepat.
        let freshUrl = url;
        if (videoId) {
          try {
            const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
            const urls = await getDirectUrls(ytUrl, 'worstvideo[acodec=none][ext=mp4]/worstvideo[ext=mp4]/worstvideo/worst', []);
            if (urls && urls[0]) freshUrl = urls[0];
          } catch (e) {
            console.warn('[sprite] getFreshUrl error, fallback:', e.message);
          }
        }
        
        let proxyWrappedUrl = `http://127.0.0.1:${process.env.PORT || 8080}/api/proxy?url=${encodeURIComponent(freshUrl)}`;

        const ffmpegExe = path.join(__dirname, '..', 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe');
        const ffmpegCmd = fs.existsSync(ffmpegExe) ? ffmpegExe : toolPaths.ffmpeg;
        const ffmpegUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

        const fps = actualCount / dur;
        const args = [
          '-skip_frame', 'nokey', // MAGIC FLAG: Skip decoding non-keyframes! Makes it 50x faster!
          '-user_agent', ffmpegUA,
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5',
          '-i', proxyWrappedUrl,
          '-vf', `fps=${fps.toFixed(6)},scale=${frameW}:${frameH},tile=${cols}x${rows}`,
          '-frames:v', '1',
          '-q:v', '4',
          '-y', outputPath
        ];

        runSpriteJob(hash, ffmpegCmd, args, outputPath, meta);
      } catch (err) {
        console.error('[sprite] background setup error:', err);
        spriteJobs.set(hash, { status: 'error', error: err.message });
        activeJobs.delete(hash);
      }
    });

    console.log(`[sprite] Job queued: ${hash.substring(0,8)} (dur=${dur}s, count=${actualCount})`);
    return res.json({ status: 'pending', jobId: hash, message: 'Sprite sedang diproses di background...' });

  } catch (err) {
    console.error('[sprite] error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
