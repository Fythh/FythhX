const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

/**
 * Mendapatkan argumen cookie yang valid
 * @returns {string} String Cookie untuk header
 */
function getCookieHeader(targetUrl) {
  const cookiesPath = path.join(__dirname, '..', 'cookies.txt');
  
  if (!fs.existsSync(cookiesPath)) return '';
  
  try {
    let targetHost = '';
    try {
      targetHost = new URL(targetUrl).hostname;
    } catch(e) {}

    const lines = fs.readFileSync(cookiesPath, 'utf8').split('\n');
    const cookies = [];
    
    for (const line of lines) {
      if (line.trim() === '' || line.startsWith('#')) continue;
      const parts = line.split('\t');
      if (parts.length >= 7) {
        const domain = parts[0];
        // [domain, flag, path, secure, expiration, name, value]
        if (targetHost && domain && targetHost.includes(domain.replace(/^\./, ''))) {
          cookies.push(`${parts[5]}=${parts[6].trim()}`);
        }
      }
    }
    
    return cookies.join('; ');
  } catch (err) {
    console.error('[Proxy] Error reading cookies.txt:', err.message);
    return '';
  }
}

/**
 * GET /api/proxy
 * Proxy video stream dengan Cookie header dari cookies.txt
 * Mendukung HTTP Range requests (Seek/Scrubbing)
 */
router.get('/proxy', (req, res) => {
  const videoUrl = req.query.url;
  
  if (!videoUrl) {
    return res.status(400).send('Missing url parameter');
  }

  // Strict header whitelist to prevent YouTube from blocking Node.js requests
  // that have conflicting browser sec-* headers.
  const headers = {};
  if (req.headers.range) {
    headers['Range'] = req.headers.range;
  }

  // Add Origin and Referer for YouTube/TikTok to prevent 403 Forbidden
  // BUT do NOT add them for googlevideo.com direct media URLs, as that causes 403s!
  try {
    const urlObj = new URL(videoUrl);
    if (urlObj.hostname.includes('youtube.com')) {
      headers['Origin'] = 'https://www.youtube.com';
      headers['Referer'] = 'https://www.youtube.com/';
    }
    
    // Force User-Agent to a known safe Chrome UA and add standard browser headers to bypass bot detection
    // Force User-Agent to a known safe Chrome UA
    if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('googlevideo.com')) {
      headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
    } else if (urlObj.hostname.includes('tiktok.com') || urlObj.hostname.includes('tiktokv.com') || urlObj.hostname.includes('tiktokcdn.com')) {
      headers['Origin'] = 'https://www.tiktok.com';
      headers['Referer'] = 'https://www.tiktok.com/';
      headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
    }
  } catch(e) {}

  // CRITICAL FIX: Do NOT pass cookies to googlevideo.com media URLs!
  // rangeDownloader works because it only sends User-Agent. 
  // Sending cookies to the direct media CDN triggers 403 Forbidden.
  
  async function attemptProxy() {
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      attempts++;
      try {
        let currentUrl = videoUrl;
        let currentHeaders = { ...headers };
        
        // YouTube strictly rejects OPEN-ENDED Range headers (e.g. bytes=0-) with 403 Forbidden.
        // We MUST close the range in the HTTP header by requesting a safe 10MB chunk.
        if (currentHeaders['Range'] && currentHeaders['Range'].endsWith('-')) {
          let rangeVal = currentHeaders['Range'].replace('bytes=', '');
          const startByte = parseInt(rangeVal.split('-')[0] || '0', 10);
          const endByte = startByte + (10 * 1024 * 1024) - 1; // 10MB chunk
          currentHeaders['Range'] = `bytes=${startByte}-${endByte}`;
        }
        
        const controller = new AbortController();
        const response = await fetch(currentUrl, { 
          headers: currentHeaders,
          signal: controller.signal
        });
        
        if (response.status === 403 || response.status === 400 || response.status === 429) {
          if (attempts < maxAttempts) {
            console.log(`[Proxy] Upstream returned ${response.status} for ranged request, retrying... (attempt ${attempts})`);
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
        }
        
        res.status(response.status);
        
        const headersToCopy = [
          'content-type', 
          'content-length', 
          'content-range', 
          'accept-ranges',
          'cache-control'
        ];
        
        headersToCopy.forEach(h => {
          const val = response.headers.get(h);
          if (val) {
            res.setHeader(h, val);
          }
        });
        
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        
        // Node 18+ Web Streams to Node.js stream
        if (response.body) {
          const { Readable } = require('stream');
          const nodeStream = Readable.fromWeb(response.body);
          
          req.on('close', () => {
            controller.abort();
            nodeStream.destroy();
          });
          
          nodeStream.pipe(res);
          
          nodeStream.on('error', (err) => {
            console.error(`[Proxy] Streaming error on attempt ${attempts}:`, err.message);
            res.end();
          });
        } else {
          res.end();
        }
        break; // Success, exit loop
        
      } catch (err) {
        console.error(`[Proxy] Stream error on attempt ${attempts}:`, err.message);
        if (attempts >= maxAttempts) {
          if (!res.headersSent) {
            res.status(500).send('Proxy error');
          }
          break;
        }
        await new Promise(r => setTimeout(r, 1500));
      }
    }
  }

  attemptProxy();
});

module.exports = router;
