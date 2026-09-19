// routes/clipper.js
// Express router for Heatmap Clipper feature

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { config } = require('../config/config');
const { scanHeatmap, getVideoInfo, processClip, checkPythonDeps, cancelJobProcesses } = require('../services/clipperService');
const jobManager = require('../utils/jobManager');

// Helper to extract videoId from YouTube URL
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

/** POST /api/clipper/scan
 * Body: { url }
 */
router.post('/clipper/scan', async (req, res) => {
  const { url } = req.body;
  const videoId = extractVideoId(url);
  if (!videoId) return res.json({ ok: false, error: 'Invalid YouTube URL' });
  try {
    const segments = await scanHeatmap(videoId);
    res.json({ ok: true, segments });
  } catch (e) {
    console.error(e);
    res.json({ ok: false, error: e.message });
  }
});

/** POST /api/clipper/clip
 * Body: { url, segments, crop, ratio, subtitle, whisperModel, subtitleFont, subtitleLocation, padding, outputDir? }
 */
router.post('/clipper/clip', async (req, res) => {
  const {
    url,
    segments,
    crop, // "default", "split_left", "split_right"
    facecamPos,
    ratio, // "9:16", "1:1", "16:9", "original"
    subtitle, // true/false
    whisperModel,
    font,
    fontArt,
    animStyle,
    animIn,
    animOut,
    fontSize,
    outlineType,
    outlineColor,
    color,
    textCase,
    posX,
    posY,
    watermark,
    padding,
    outputDir,
    uploader,
    maxWords,
    letterSpacing,
    resolution,
    resolutionHeight,
    subtitleEngine,
    groqApiKey,
    cfAccountId,
    cfApiToken
  } = req.body;
  const videoId = extractVideoId(url);
  if (!videoId) return res.json({ ok: false, error: 'Invalid URL' });
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const job = {
    id: jobId,
    status: 'queued',
    progress: 0,
    total: 100,
    logs: [],
    outputs: [],
    segmentsData: segments,
    createdAt: new Date(),
  };
  jobManager.set(jobId, job);
  
  function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // Kick off async processing (do not await)
  (async () => {
    job.status = 'running';
    const deps = await checkPythonDeps();
    const finalDir = config.paths.clips;
    const cacheDir = path.join(config.paths.cache, 'clips');
    if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    
    job.logs.push('Persiapan memotong segmen...');
    for (let i = 0; i < segments.length; i++) {
      if (job.status === 'cancelled') break;
      const seg = segments[i];
      job.logs.push(`Processing segment ${i + 1}/${segments.length}`);
      
      job.currentSegmentIndex = i;
      job.segmentProgress = 0;
      job.progress = (i / segments.length) * 100;

      try {
        const outFile = await processClip({
          videoId,
          segment: seg,
          outputDir: cacheDir,
          cropMode: crop,
          facecamPos,
          ratio,
          subtitle,
          whisperModel,
          font,
          fontSize,
          fontArt,
          animStyle,
          animIn,
          animOut,
          outlineType,
          outlineColor,
          color,
          textCase,
          posX,
          posY,
          letterSpacing,
          maxWords,
          watermark,
          padding,
          resolution,
          resolutionHeight,
          subtitleEngine,
          groqApiKey,
          cfAccountId,
          cfApiToken,
          jobId,
          deps,
          onLog: (msg) => {
            job.logs.push(msg);
            
            // Parse yt-dlp / rangeDownloader progress
            const ytdlpMatch = msg.match(/\[yt-dlp\] Downloading segment\.\.\. (\d+\.?\d*)%/);
            if (ytdlpMatch) {
              job.segmentProgress = Math.min(95, parseFloat(ytdlpMatch[1]));
            }
            // Parse ffmpeg progress (rough estimate)
            const timeMatch = msg.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            if (timeMatch && seg.duration) {
              const hrs = parseInt(timeMatch[1], 10);
              const mins = parseInt(timeMatch[2], 10);
              const secs = parseFloat(timeMatch[3]);
              const totalSecs = (hrs * 3600) + (mins * 60) + secs;
              const targetDur = seg.duration + (padding * 2);
              let pct = (totalSecs / targetDur) * 100;
              job.segmentProgress = Math.max(job.segmentProgress, Math.min(99, pct));
            }
            
            // Calculate overall job progress
            job.progress = ((i + (job.segmentProgress / 100)) / segments.length) * 100;
          },
        });
        
        const startStr = formatTime(seg.start).replace(/:/g, '.');
        const endStr = formatTime(seg.start + seg.duration).replace(/:/g, '.');
        const safeUploader = (uploader || 'Kreator').replace(/[^\w\s\-\.\(\)\[\]~]/g, '').trim().replace(/\s+/g, ' ');
        const finalFilename = `Clips ${i + 1} - ${safeUploader || 'Kreator'} - ${startStr} - ${endStr}.mp4`;
        const finalPath = path.join(finalDir, finalFilename);
        fs.renameSync(outFile, finalPath);
        job.outputs.push({ filename: finalFilename, path: finalPath });
        job.progress = ((i + 1) / segments.length) * 100;
      } catch (e) {
        if (job.status !== 'cancelled') {
          job.logs.push(`Error on segment ${i + 1}: ${e.message}`);
          job.status = 'error';
        }
        break;
      }
    }
    if (job.status !== 'error' && job.status !== 'cancelled') {
      job.status = 'done';
      if (job.outputs.length > 0) {
        // Auto-open removed per user request
      }
    }
  })();
  res.json({ ok: true, jobId });
});

/** GET /api/clipper/job/:jobId */
router.get('/clipper/job/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobManager.get(jobId);
  if (!job) return res.json({ ok: false, error: 'Job not found' });
  res.json({ ok: true, job });
});

/** POST /api/clipper/cancel/:jobId */
router.post('/clipper/cancel/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobManager.get(jobId);
  if (!job) return res.json({ ok: false, error: 'Job not found' });
  // Cancel active processes
  cancelJobProcesses(jobId);
  job.status = 'cancelled';
  job.logs.push('Proses dibatalkan oleh pengguna.');
  res.json({ ok: true });
});

/** GET /api/clipper/file/:jobId/:filename */
router.get('/clipper/file/:jobId/:filename', (req, res) => {
  const { jobId, filename } = req.params;
  // File is saved in clips
  const filePath = path.join(config.paths.clips, filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ ok: false, error: 'File not found' });
  }
});
// Preview endpoint: returns embed URL for a given videoId and optional start/end times
// Also fetches a direct stream URL via yt-dlp for native video preview
router.get('/clipper/preview', async (req, res) => {
  const { videoId, start, end } = req.query;
  if (!videoId) return res.json({ ok: false, error: 'Missing videoId' });
  const embedUrl = `https://www.youtube.com/embed/${videoId}?start=${start || 0}&end=${end || 0}`;

  // Try to get a direct stream URL for native video preview
  try {
    const { getDirectUrls } = require('../services/rangeDownloader');
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
    // Use a low quality split format to avoid 403 on seeks
    const formatSelector = 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[height<=480]';
    const directUrls = await getDirectUrls(ytUrl, formatSelector, [], () => {});
    if (directUrls && directUrls.length > 0) {
      return res.json({ 
        ok: true, 
        embedUrl, 
        directUrl: directUrls[0],
        directAudioUrl: directUrls.length > 1 ? directUrls[1] : null
      });
    }
  } catch (e) {
    console.warn('[clipper/preview] Could not get directUrl:', e.message);
  }

  res.json({ ok: true, embedUrl, directUrl: null });
});

/** POST /api/clipper/check-deps */
router.post('/clipper/check-deps', async (req, res) => {
  try {
    const deps = await checkPythonDeps();
    res.json({ ok: true, deps });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

/** POST /api/clipper/validate-key */
router.post('/clipper/validate-key', async (req, res) => {
  const { provider, apiKey, accountId, apiToken } = req.body;
  const https = require('https');
  
  if (provider === 'groq') {
    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/models',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` }
    };
    const reqApi = https.request(options, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        if (resp.statusCode === 200) {
          res.json({ valid: true, message: 'Valid ✓' });
        } else {
          try {
            const parsed = JSON.parse(data);
            res.json({ valid: false, error: parsed.error?.message || 'Invalid Key' });
          } catch(e) {
            res.json({ valid: false, error: 'Invalid Key' });
          }
        }
      });
    });
    reqApi.on('error', (e) => res.json({ valid: false, error: e.message }));
    reqApi.end();
  } else if (provider === 'cloudflare') {
    const options = {
      hostname: 'api.cloudflare.com',
      path: `/client/v4/accounts/${accountId}/ai/models/search`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiToken}` }
    };
    const reqApi = https.request(options, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        if (resp.statusCode === 200) {
          res.json({ valid: true, message: 'Valid ✓' });
        } else {
          try {
            const parsed = JSON.parse(data);
            const err = parsed.errors && parsed.errors.length > 0 ? parsed.errors[0].message : 'Invalid Credentials';
            res.json({ valid: false, error: err });
          } catch(e) {
            res.json({ valid: false, error: 'Invalid Credentials' });
          }
        }
      });
    });
    reqApi.on('error', (e) => res.json({ valid: false, error: e.message }));
    reqApi.end();
  } else {
    res.json({ valid: false, error: 'Unknown provider' });
  }
});

module.exports = router;
