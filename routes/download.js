/**
 * Download Routes
 *
 * POST /api/download - Download video/audio dari URL
 *
 * FIX: Streaming now uses res.flushHeaders() + res.flush() to ensure
 * progress chunks are delivered immediately to the client instead of
 * being buffered by Node.js / Express.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const { exec } = require('child_process');
const { config } = require('../config/config');
const ytDlpService = require('../services/ytDlpService');
const shopeeService = require('../services/shopeeVideoService');

/**
 * POST /api/download
 * Download video/audio dengan streaming progress
 */
router.post('/download', async (req, res) => {
  const { url, format, quality, qualityHeight, start, end, title } = req.body;

  // --- Input Validation (before any headers are sent) ---
  if (!url) {
    return res.status(400).json({ success: false, error: 'URL harus diisi' });
  }
  if (!format || !['mp4', 'mp3'].includes(format)) {
    return res.status(400).json({ success: false, error: 'Format harus mp4 atau mp3' });
  }
  if (!quality) {
    return res.status(400).json({ success: false, error: 'Quality harus dipilih' });
  }

  // --- Setup streaming response BEFORE starting download ---
  // Setting Content-Type to text/plain and calling flushHeaders() immediately
  // breaks the TCP buffering hold that Express applies when it hasn't sent
  // headers yet. Without this, res.write() calls are buffered and the client
  // sees nothing until the entire response is done.
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('Connection', 'keep-alive');

  // CRITICAL: flush headers immediately so the client connection is
  // established and subsequent res.write() calls are streamed in real-time.
  res.flushHeaders();

  const safeWrite = (obj) => {
    try {
      res.write(JSON.stringify(obj) + '\n');
      // res.flush() is available when compression middleware (like compression)
      // is NOT used, which is the case here. Safe to call on raw ServerResponse.
      if (typeof res.flush === 'function') res.flush();
    } catch (e) {
      // Client disconnected - ignore write errors
    }
  };

  const fs = require('fs');
  const isTrimming = (start !== undefined && start !== '' && end !== undefined && end !== '');
  const downloadDir = isTrimming ? config.paths.trim : config.paths.downloads;
  
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  const onProgress = (progressData) => {
    safeWrite({ type: 'progress', data: progressData });
  };

  try {
    const browser = req.body.browser || 'none';

    let result;
    if (shopeeService.isShopeeVideoUrl(url)) {
      result = await shopeeService.downloadDirect(url, downloadDir, title, onProgress);
    } else {
      result = await ytDlpService.downloadMedia(
        url, format, quality, qualityHeight, downloadDir, onProgress, start, end, title, browser
      );
    }

    let finalResult = result;
    const { uploader } = req.body;
    
    // Jika proses trim, cari file hasil trim dan ganti namanya
    if (isTrimming) {
      try {
        let filepath = result.filePath;
        
        // Jika tidak ada filePath dari result (kasus yt-dlp fallback), cari manual
        if (!filepath) {
          const files = fs.readdirSync(downloadDir);
          // formatTime logic as used in rangeDownloader
          function ft(seconds) {
            const s = parseFloat(seconds);
            if (isNaN(s)) return '';
            return Number(s).toFixed(2).replace(/\.00$/, '');
          }
          const startStrRaw = ft(start);
          const endStrRaw = ft(end);
          const downloadedFile = files.find(f => f.includes(`_trim_${startStrRaw}_${endStrRaw}`) || f.includes(`_trim_${start}_${end}`));
          if (downloadedFile) {
            filepath = path.join(downloadDir, downloadedFile);
          }
        }
        
        if (filepath && fs.existsSync(filepath)) {
          function formatTimeFriendly(seconds) {
            const s = parseFloat(seconds);
            if (isNaN(s)) return '0.00';
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const sec = Math.floor(s % 60);
            if (h > 0) return `${h}.${String(m).padStart(2, '0')}.${String(sec).padStart(2, '0')}`;
            return `${m}.${String(sec).padStart(2, '0')}`;
          }
          
          const startStr = formatTimeFriendly(start);
          const endStr = formatTimeFriendly(end);
          const safeUploader = (uploader || 'Video').replace(/[^\w\s\-\.\(\)\[\]~]/g, '').trim().replace(/\s+/g, ' ');
          const newFilename = `Trim - ${safeUploader || 'Video'} - ${startStr} - ${endStr}${path.extname(filepath)}`;
          const newFilepath = path.join(downloadDir, newFilename);
          
          fs.renameSync(filepath, newFilepath);
          finalResult = {
            ...result,
            filename: newFilename,
            filepath: newFilepath,
            url: `/downloads/trim/${encodeURIComponent(newFilename)}`
          };
        } else {
          console.error('Trim rename failed: File not found. Tried path:', filepath, 'and searched for start/end:', start, end);
        }
      } catch (err) {
        console.error('Failed to rename trim file:', err);
      }
    } else {
      // Full download: cari file terbaru di folder downloads
      try {
        const fs = require('fs');
        if (fs.existsSync(downloadDir)) {
          const files = fs.readdirSync(downloadDir);
          let newestFile = null;
          let newestTime = 0;
          files.forEach(f => {
            if (f.endsWith('.part') || f.endsWith('.ytdl') || f.endsWith('.tmp_mux.mp4')) return;
            const filepath = path.join(downloadDir, f);
            const stat = fs.statSync(filepath);
            // Gunakan birthtimeMs (waktu pembuatan file di disk) karena mtimeMs sering diubah yt-dlp ke tanggal upload video asli
            if (stat.isFile() && stat.birthtimeMs > newestTime) {
              newestTime = stat.birthtimeMs;
              newestFile = f;
            }
          });
          // Hapus batasan 15 detik yang ketat karena proses muxing bisa lama
          if (newestFile) {
            finalResult = {
              ...result,
              filename: newestFile,
              filepath: path.join(downloadDir, newestFile),
              url: `/downloads/${encodeURIComponent(newestFile)}`
            };
          }
        }
      } catch (err) {
        console.error('Failed to get full download filename:', err);
      }
    }

    safeWrite({ type: 'complete', data: finalResult });
    res.end();

  } catch (error) {
    console.error('Download error:', error);

    // Headers sudah dikirim — kirim error sebagai stream chunk
    safeWrite({
      type: 'error',
      data: { success: false, error: error.message }
    });
    res.end();
  }
});

module.exports = router;