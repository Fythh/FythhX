/**
 * YtDlp Service (ULTRA-COMPATIBLE VERSION)
 * 
 * Untuk yt-dlp version lama yang tidak support newer options
 * Tested dengan yt-dlp 2022+ versions
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const toolPaths = require('../utils/toolPaths');
const rangeDownloader = require('./rangeDownloader');

let activeDownloadProcess = null;

/**
 * Mendapatkan argumen cookie yang valid
 * @param {string} [browser] - Nama browser (chrome, edge, firefox)
 * @returns {Array} Argumen cookie untuk yt-dlp
 */
function getCookieArgs(browser, url = '') {
  const args = [
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
  ];

  if (url.includes('kick.com')) {
    args.push('--impersonate', 'chrome');
  }

  // Bypass cookies for YouTube to prevent SABR experiment from blocking 4K/DASH formats
  const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
  if (isYouTube) {
    return args;
  }

  if (browser && browser !== 'none' && browser !== '') {
    console.log(`Menggunakan cookies otomatis dari browser: ${browser}`);
    args.push('--cookies-from-browser', browser.toLowerCase());
    return args;
  }

  const cookiesPath = path.join(__dirname, '..', 'cookies.txt');
  
  if (fs.existsSync(cookiesPath)) {
    const cookieSize = fs.statSync(cookiesPath).size;
    
    // Validasi cookies.txt tidak kosong dan terformat dengan benar
    if (cookieSize > 50) {
      console.log(`Menggunakan cookies.txt lokal (${cookieSize} bytes)`);
      args.push('--cookies', cookiesPath);
    } else {
      console.warn('cookies.txt terlalu kecil atau kosong, fallback ke strategy lain');
    }
  }
  
  return args;
}

/**
 * Cek apakah yt-dlp sudah terinstall
 * @returns {boolean}
 */
function isYtDlpInstalled() {
  try {
    execSync(`"${toolPaths.ytdlp}" --version`, { stdio: 'pipe' });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Get yt-dlp version string
 * @returns {string}
 */
function getYtDlpVersion() {
  try {
    const version = execSync(`"${toolPaths.ytdlp}" --version`, { stdio: 'pipe' }).toString().trim();
    return version;
  } catch (err) {
    return 'unknown';
  }
}

/**
 * Fetch metadata dari URL menggunakan yt-dlp
 * @param {string} url - URL video
 * @param {string} [browser] - Opsi browser
 * @returns {Promise<Object>} - Metadata video (title, thumbnail, duration, formats)
 */
async function fetchMetadata(url, browser) {
  return new Promise((resolve, reject) => {
    if (!isYtDlpInstalled()) {
      return reject(new Error('yt-dlp belum terinstall. Silakan install terlebih dahulu: pip install yt-dlp'));
    }

    // Command untuk mendapatkan metadata dalam format JSON
    // MINIMAL OPTIONS untuk kompatibilitas maksimal
    const command = toolPaths.ytdlp;
    const args = [
      '-j', // Output JSON
      '--no-warnings',
      '--force-ipv4', // Prevent IP mismatch with proxy (forces IPv4 signature)
      '--js-runtimes', 'node', // Fix JS challenge
      ...getCookieArgs(browser, url),
      url
    ];

    console.log(`Mengambil metadata dari: ${url}`);
    console.log(`yt-dlp version: ${getYtDlpVersion()}`);

    let output = '';
    let errorOutput = '';

    const process = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    process.stdout.on('data', (data) => {
      output += data.toString();
    });

    process.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.log(`[yt-dlp stderr]: ${data.toString()}`);
    });

    process.on('close', (code) => {
      if (code === 0) {
        try {
          // Output bisa jadi multiple JSON objects, kita ambil yang pertama
          const lines = output.trim().split('\n').filter(line => line.trim());
          const jsonStr = lines[0];
          const metadata = JSON.parse(jsonStr);
          // --- PREVIEW URL SELECTION ---
          const rawFormats = metadata.formats || [];
          let previewUrl = null;
          let previewFormat = null;
          let previewAudioUrl = null;
          
          // Priority 1: Best MP4 video-only stream (usually 1080p, 720p, or 360p DASH)
          // We MUST use a video-only DASH stream for the preview so the browser can seek without getting 403 Forbidden.
          // YouTube blocks HTTP Range offset requests for combined streams (like format 18).
          for (let i = rawFormats.length - 1; i >= 0; i--) {
            const f = rawFormats[i];
            if (f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none') && f.ext === 'mp4' && f.url && !f.url.includes('.m3u8')) {
              previewUrl = f.url;
              previewFormat = f;
              if (f.height === 360 || f.height === 480 || f.height === 720) break; // Good enough for preview
            }
          }
          
          // Also fetch a DASH audio stream to sync with the video
          for (let i = rawFormats.length - 1; i >= 0; i--) {
            const f = rawFormats[i];
            if (f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none') && f.url && !f.url.includes('.m3u8')) {
              previewAudioUrl = f.url;
              break;
            }
          }
          
          // Fallback to format 18 (seeking will 403, but it's a fallback)
          if (!previewUrl) {
            const fmt18 = rawFormats.find(f => f.format_id === '18');
            if (fmt18 && fmt18.url) {
              previewUrl = fmt18.url;
              previewFormat = fmt18;
            }
          }

          // Extract User-Agent from the specific format used for preview
          // This is critical: ANDROID_VR URLs need ANDROID_VR UA, web URLs need web UA
          let userAgent = null;
          if (previewFormat && previewFormat.http_headers && previewFormat.http_headers['User-Agent']) {
            userAgent = previewFormat.http_headers['User-Agent'];
          } else if (metadata.http_headers && metadata.http_headers['User-Agent']) {
            userAgent = metadata.http_headers['User-Agent'];
          }
          console.log(`[preview] Using format_id=${previewFormat ? previewFormat.format_id : 'none'} client=${previewFormat && previewFormat.http_headers ? 'has-headers' : 'no-headers'} ua=${userAgent ? userAgent.substring(0,50) : 'default'}`);

          // Bersihkan emoji dan special character untuk mencegah bug Windows file system
          const rawTitle = metadata.title || 'Unknown';
          const cleanTitle = rawTitle.replace(/[^\w\s\-\.\(\)\[\]~]/g, '').trim().replace(/\s+/g, ' ') || 'Video_Tanpa_Judul';

          // Extract informasi penting
          const result = {
            title: cleanTitle,
            thumbnail: metadata.thumbnail || null,
            duration: metadata.duration || 0,
            uploader: metadata.uploader || 'Unknown',
            formats: extractFormats(rawFormats),
            previewUrl: previewUrl,
            previewAudioUrl: previewAudioUrl,
            userAgent: userAgent,
            rawFormatCount: rawFormats.length
          };

          console.log(`✓ Metadata berhasil diambil: ${result.title}`);
          console.log(`✓ Total formats available: ${result.rawFormatCount}`);
          resolve(result);
        } catch (err) {
          reject(new Error(`Gagal parse metadata JSON: ${err.message}`));
        }
      } else {
        // Parse error message untuk memberikan hint yang lebih baik
        const errorMsg = errorOutput || 'Unknown error';
        
        if (errorMsg.includes('Sign in to confirm')) {
            reject(new Error(`  [Authentication Error]\n\nYouTube memerlukan autentikasi.\n\nSOLUSI:\n1. Buka Settings (ikon gerigi di pojok kiri atas).\n2. Pilih browser yang Anda gunakan untuk login YouTube (misal Chrome atau Firefox).\n3. Klik Simpan dan coba lagi.\n\n(Jika opsi Chrome error, gunakan file cookies.txt)`));
          } else if (errorMsg.includes('Requested format is not available')) {
            reject(new Error(`  [Format Error]\n\nFormat yang diminta tidak tersedia untuk video ini.\n\nSOLUSI:\n- Refresh metadata untuk melihat format yang tersedia\n- Pilih quality/format berbeda\n- Update yt-dlp: pip install --upgrade yt-dlp`));
          } else if (errorMsg.includes('Instagram sent an empty media response') || errorMsg.includes('Unexpected response from webpage request') || errorMsg.includes('Login required') || errorMsg.toLowerCase().includes('login')) {
            reject(new Error(`  [Multiplatform Login Required]\n\nInstagram / TikTok memblokir akses bot.\n\nSOLUSI (Bypass Cookies):\n1. Pastikan Anda sudah login akun IG/TikTok di browser.\n2. Buka menu Settings (Ikon Gerigi) di FytX.\n3. Pilih nama browser yang Anda gunakan (misal: Firefox).\n4. Jika opsi browser gagal, barulah gunakan file cookies.txt.`));
          } else {
            reject(new Error(`yt-dlp error (code ${code}):\n${errorMsg.substring(0, 200)}`));
          }
      }
    });

    process.on('error', (err) => {
      reject(new Error(`Gagal menjalankan yt-dlp: ${err.message}`));
    });
  });
}

/**
 * Extract format yang tersedia dari metadata
 * @param {Array} formats - Array format dari yt-dlp
 * @returns {Object} - Grouped formats untuk video dan audio
 */
function extractFormats(formats) {
  console.log(` Processing ${formats.length} formats...`);
  
  const videoFormats = new Map();
  const audioFormats = new Map();

  formats.forEach(format => {
    // Video formats
    if (format.vcodec && format.vcodec !== 'none' && format.height) {
      const resolution = `${format.height}p`;
      const existing = videoFormats.get(resolution);
      
      if (!existing || 
          (format.fps || 30) > (existing.fps || 30) ||
          ((format.fps || 30) === (existing.fps || 30) && (format.filesize || 0) > (existing.filesize || 0))) {
        videoFormats.set(resolution, {
          format_id: format.format_id,
          resolution: resolution,
          height: format.height,
          fps: format.fps || 30,
          vcodec: format.vcodec,
          acodec: format.acodec || 'none',
          filesize: format.filesize,
          ext: format.ext || 'mp4',
          url: format.url || ''
        });
      }
    }

    // Audio formats
    if (format.acodec && format.acodec !== 'none' && format.vcodec === 'none') {
      const abr = format.abr || 0;
      const bitrate = abr ? `${abr}k` : `${format.tbr || 0}k`;
      const existing = audioFormats.get(bitrate);
      
      if (!existing || (format.abr || 0) > (existing.abr || 0)) {
        audioFormats.set(bitrate, {
          format_id: format.format_id,
          bitrate: bitrate,
          acodec: format.acodec,
          abr: format.abr,
          filesize: format.filesize,
          ext: format.ext || 'mp4',
          url: format.url || ''
        });
      }
    }
  });

  const sortedVideo = Array.from(videoFormats.values())
    .sort((a, b) => (b.height || 0) - (a.height || 0))
    .slice(0, 10);

  const sortedAudio = Array.from(audioFormats.values())
    .sort((a, b) => (b.abr || 0) - (a.abr || 0))
    .slice(0, 8);

  console.log(`✓ Video formats found: ${sortedVideo.length}`);
  console.log(`✓ Audio formats found: ${sortedAudio.length}`);

  return {
    video: sortedVideo,
    audio: sortedAudio
  };
}

/** Normalize title for fuzzy filename matching (yt-dlp sanitizes special chars) */
function normalizeForMatch(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Find a previously downloaded full video file in downloads folder */
function findLocalVideoFile(downloadDir, title) {
  if (!title || !fs.existsSync(downloadDir)) return null;
  const normTitle = normalizeForMatch(title);
  if (!normTitle) return null;

  try {
    const files = fs.readdirSync(downloadDir);
    let bestMatch = null;
    let bestScore = 0;

    for (const f of files) {
      if (!f.toLowerCase().endsWith('.mp4')) continue;
      if (f.includes('_trim_')) continue;

      const fullPath = path.join(downloadDir, f);
      const stat = fs.statSync(fullPath);
      if (stat.size < 512 * 1024) continue;

      const normFile = normalizeForMatch(path.basename(f, path.extname(f)));
      if (normFile === normTitle) return fullPath;

      const shorter = normTitle.length < normFile.length ? normTitle : normFile;
      const longer = normTitle.length >= normFile.length ? normTitle : normFile;
      if (longer.includes(shorter) && shorter.length >= 12) {
        const score = shorter.length;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = fullPath;
        }
      }
    }
    return bestMatch;
  } catch {
    return null;
  }
}

/** Build yt-dlp format string optimized for section trimming (prefer H.264 MP4) */
function getTrimFormatString(qualityHeight, quality) {
  let h = qualityHeight;
  if (!h && typeof quality === 'string') {
    if (quality.endsWith('p')) h = quality.replace('p', '');
    else if (/^\d+$/.test(quality)) h = '1080';
  }
  h = h || '1080';
  
  const isExactFormat = quality && !quality.endsWith('p') && quality !== 'best';
  const rules = [];

  if (isExactFormat) {
    // Utamakan format_id pilihan user, TAPI tetap paksa [ext=mp4] 
    // karena rangeDownloader (sidx parser) belum support WebM.
    rules.push(`${quality}[ext=mp4]+ba[ext=m4a]`);
  }

  // Jika resolusi <= 1080, kita sangat memprioritaskan H.264 (avc1) karena paling ringan dan cepat.
  // Tapi H.264 di YouTube mentok di 1080p. Jika minta 4K dan dipaksa avc1, malah cuma dapat 1080p.
  if (parseInt(h) <= 1080) {
    rules.push(`bv*[height<=${h}][vcodec^=avc1][ext=mp4]+ba[ext=m4a]`);
  }

  // Fallback umum: ambil format MP4 beresolusi paling mendekati 'h' (Bisa AV1 untuk 1440p/2160p)
  rules.push(`bv*[height<=${h}][ext=mp4]+ba[ext=m4a]`);
  rules.push(`b[height<=${h}][ext=mp4]`);
  rules.push('b');

  return rules.join('/');
}

/** Parse FFmpeg time= progress from a single line */
function parseFfmpegSectionProgress(line, start, end) {
  const totalDuration = parseFloat(end) - parseFloat(start);
  if (totalDuration <= 0) return null;

  const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/);
  if (!timeMatch) return null;

  const currentSeconds = (parseFloat(timeMatch[1]) * 3600) + (parseFloat(timeMatch[2]) * 60) + parseFloat(timeMatch[3]);
  let percent = (currentSeconds / totalDuration) * 100;
  if (percent > 100) percent = 100;
  return parseFloat(percent.toFixed(1));
}

/** Trim an existing local file with FFmpeg (instant seek, reliable progress) */
function trimLocalFile(inputPath, start, end, downloadDir, onProgress) {
  return new Promise((resolve, reject) => {
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const formatTime = (t) => Number(t).toFixed(2).replace(/\.00$/, '');
    const outPath = path.join(downloadDir, `${baseName}_trim_${formatTime(start)}_${formatTime(end)}.mp4`);
    const sectionDuration = parseFloat(end) - parseFloat(start);
    const startedAt = Date.now();
    let lastProgressAt = Date.now();
    let lastPercent = 0;

    const emit = (percent, status) => {
      lastProgressAt = Date.now();
      lastPercent = percent;
      if (onProgress) {
        onProgress({ progress: percent, speed: null, eta: null, status });
      }
    };

    emit(0, 'Memotong dari file lokal (cepat)...');

    const args = [
      '-y', '-ss', String(start), '-to', String(end),
      '-i', inputPath,
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      outPath
    ];

    const proc = spawn(toolPaths.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    activeDownloadProcess = proc;

    let stderrLineBuffer = '';

    proc.stderr.on('data', (data) => {
      stderrLineBuffer += data.toString();
      const lines = stderrLineBuffer.split(/[\r\n]+/);
      stderrLineBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const percent = parseFfmpegSectionProgress(line.trim(), 0, sectionDuration);
        if (percent !== null) emit(percent, 'Memotong file lokal...');
      }
    });

    proc.on('close', (code) => {
      activeDownloadProcess = null;
      if (code === 0 && fs.existsSync(outPath)) {
        emit(100, 'Selesai');
        resolve({ success: true, message: 'Download selesai', status: 'Selesai' });
      } else if (code === null) {
        reject(new Error('Download dibatalkan'));
      } else {
        reject(new Error(`FFmpeg trim gagal (code ${code})`));
      }
    });

    proc.on('error', (err) => {
      activeDownloadProcess = null;
      reject(new Error(`Gagal menjalankan FFmpeg: ${err.message}`));
    });
  });
}

/**
 * Download video/audio dari URL menggunakan yt-dlp
 * @param {string} url - URL video
 * @param {string} format - Format output (mp4 atau mp3)
 * @param {string} quality - Kualitas (resolusi untuk video, bitrate untuk audio)
 * @param {string} downloadDir - Direktori tujuan
 * @param {Function} onProgress - Callback untuk progress
 * @param {string} [start] - Trim start (seconds)
 * @param {string} [end] - Trim end (seconds)
 * @param {string} [title] - Video title for local-file fast path
 * @param {string} [browser] - Browser options
 * @returns {Promise<Object>} - Info file yang didownload
 */
async function downloadMedia(url, format, quality, qualityHeight, downloadDir, onProgress, start, end, title, browser) {
  const isTrimming = (start !== undefined && end !== undefined && start !== '' && end !== '');

  if (isTrimming && format === 'mp4' && title) {
    const localFile = findLocalVideoFile(downloadDir, title);
    if (localFile) {
      console.log(`Trim cepat dari file lokal: ${path.basename(localFile)}`);
      return trimLocalFile(localFile, start, end, downloadDir, onProgress);
    }
  }

  // REMOTE TRIM (no local file yet): byte-range approach.
  // Replaces the old `--download-sections` + remote-ffmpeg-seek path, which
  // was prone to stalling / 403 on DASH streams (see docs).
  // Native yt-dlp trim using --download-sections with extra stability flags failed.
  if (isTrimming && format === 'mp4') {
    const formatSelector = getTrimFormatString(qualityHeight, quality);
    console.log(`Remote trim via byte-range | format: ${formatSelector}`);
    try {
      const result = await rangeDownloader.remoteTrimByteRange(
        url, formatSelector, start, end, downloadDir, title || 'video', getCookieArgs(browser, url), onProgress,
        (proc) => { activeDownloadProcess = proc; }
      );
      console.log('Remote byte-range trim selesai');
      return result;
    } catch (err) {
      console.error(`Byte-range remote trim gagal: ${err.message}`);
      throw new Error(
        `Gagal memotong video langsung dari YouTube (byte-range): ${err.message}\n\n` +
        `Saran: download video FULL dulu (tombol Download Full), lalu jalankan trim lagi — ` +
        `nanti otomatis lewat jalur lokal yang jauh lebih stabil.`
      );
    }
  }
  return runYtDlpDownload(url, format, quality, qualityHeight, downloadDir, onProgress, start, end, isTrimming, browser, title);
}

function runYtDlpDownload(url, format, quality, qualityHeight, downloadDir, onProgress, start, end, isTrimming, browser, title) {
  return new Promise((resolve, reject) => {
    if (!isYtDlpInstalled()) {
      return reject(new Error('yt-dlp belum terinstall'));
    }

    console.log(`Downloading: ${url} | Format: ${format} | Quality: ${quality} | Height: ${qualityHeight}`);

    const ffmpegPath = path.join(__dirname, '..', 'tools', 'ffmpeg', 'bin');
    const isTrimming = (start !== undefined && end !== undefined && start !== '' && end !== '');

    const args = [
      '--no-warnings',
      '--force-ipv4',
      '--newline',           // Force yt-dlp to flush progress per line
      '--js-runtimes', 'node',
      ...getCookieArgs(browser, url)
    ];

    // Gunakan title yang sudah dibersihkan jika tersedia, kalau tidak fallback ke title sanitization dari yt-dlp
    let safeTitle = (title || '%(title)s').replace(/[^\w\s\-\.\(\)\[\]~]/g, '').trim().replace(/\s+/g, ' ');
    if (!safeTitle) safeTitle = 'Video_Tanpa_Judul';

    args.push('-o', isTrimming 
      ? path.join(downloadDir, `${safeTitle}_trim_${start}_${end}.%(ext)s`) 
      : path.join(downloadDir, `${safeTitle}.%(ext)s`)
    );

    if (isTrimming) {
      args.push('--download-sections', `*${start}-${end}`);
      args.push('--force-keyframes-at-cuts');
      args.push('--socket-timeout', '30');
      args.push('--retries', '10');
      args.push('--force-overwrites');
      args.push('--postprocessor-args', 'ffmpeg:-stats_period 1');
    }

    // Add ffmpeg location
    if (fs.existsSync(path.join(ffmpegPath, 'ffmpeg.exe'))) {
      args.push('--ffmpeg-location', ffmpegPath);
    }

    if (format === 'mp4') {
      let formatString;
      
      // Prefer H.264 MP4 for trimming — enables faster HTTP seek vs AV1/WebM
      if (isTrimming) {
        formatString = getTrimFormatString(qualityHeight, quality);
      } else {
        // Normal download behavior
        if (!quality || quality === 'best') {
          formatString = 'bestvideo+bestaudio/best';
        } else if (typeof quality === 'string' && quality.endsWith('p')) {
          const h = quality.replace('p', '');
          formatString = `bv*[height=${h}]+ba/bv*[height<=${h}]+ba/best`;
        } else {
          // quality is an exact format_id (e.g. '299', '137', '399', '220')
          formatString = `${quality}+bestaudio/bestvideo+bestaudio/best`;
        }
      }

      args.push('-f', formatString);
      args.push('--merge-output-format', 'mp4');
      if (!isTrimming) {
        args.push('--postprocessor-args', 'ffmpeg:-c:v copy -c:a aac -b:a 192k');
      }
    } else if (format === 'mp3') {
      args.push('-f', 'bestaudio/best');
      args.push('-x');
      args.push('--audio-format', 'mp3');
      args.push('--audio-quality', '192');
    }

    args.push(url);

    console.log(`🔧 Download format: ${format === 'mp4' ? (quality === 'best' ? 'bestvideo+bestaudio/best' : `${quality}+bestaudio/best`) : 'bestaudio/best'} | Trimming: ${isTrimming}`);

    let output = '';
    let errorOutput = '';
    let resolved = false;
    const startedAt = Date.now();
    let lastProgressAt = Date.now();
    let lastPercent = 0;
    let currentPhase = isTrimming ? 'Mempersiapkan potongan video...' : 'Mendownload video (Kecepatan penuh)...';

    const emitProgress = (percent, status, extra = {}) => {
      lastProgressAt = Date.now();
      lastPercent = percent;
      if (status) currentPhase = status;
      if (onProgress) {
        onProgress({
          progress: percent,
          speed: extra.speed !== undefined ? extra.speed : null,
          eta: extra.eta !== undefined ? extra.eta : null,
          status: status || currentPhase
        });
      }
    };

    const processYtDlpLine = (line, isStderr) => {
      if (!line) return;

      if (isStderr) {
        if (line.toLowerCase().includes('error')) {
          console.error(`[yt-dlp Error]: ${line}`);
        } else if (line.toLowerCase().includes('warning')) {
          console.warn(`[yt-dlp Warning]: ${line}`);
        }
      }
      
      if (isTrimming && (line.startsWith('frame=') || line.includes('time='))) {
        const ffPercent = parseFfmpegSectionProgress(line, start, end);
        if (ffPercent !== null) emitProgress(ffPercent, 'Mendownload potongan video...');
      }

      if (line.includes('[download]')) {
        const percentMatch = line.match(/\[download\]\s+([\d.]+)%/);
        const speedMatch = line.match(/at\s+([^\s]+)\/s/);
        const etaMatch = line.match(/ETA\s+([\d:]+)/);

        if (percentMatch) {
          emitProgress(parseFloat(percentMatch[1]), isTrimming ? 'Mendownload klip video...' : 'Sedang download...', {
            speed: speedMatch ? `${speedMatch[1]}/s` : null,
            eta: etaMatch ? etaMatch[1] : null
          });
        } else if (line.includes('Destination:')) {
          emitProgress(0, isTrimming ? 'Menginisialisasi pemotongan video...' : 'Menginisialisasi file...');
        } else if (line.includes('100%')) {
          emitProgress(100, 'Memproses...');
        }
      } else if (line.includes('[Merger]') || line.includes('[ffmpeg]') || line.includes('[ExtractAudio]')) {
        emitProgress(Math.max(lastPercent, 99), 'Memproses dengan FFmpeg...');
      } else if ((line.includes('[youtube]') || line.includes('[info]')) && !isTrimming) {
        emitProgress(0, 'Mengambil info video...');
      } else if (isTrimming && (line.includes('[youtube]') || line.includes('[info]'))) {
        emitProgress(lastPercent, 'Mengambil info video...');
      }
    };

    const process = spawn(toolPaths.ytdlp, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    activeDownloadProcess = process;

    emitProgress(0, currentPhase);

    let lineBuffer = '';

    process.stdout.on('data', (data) => {
      const dataStr = data.toString();
      output += dataStr;
      lineBuffer += dataStr;
      const lines = lineBuffer.split(/[\r\n]+/);
      lineBuffer = lines.pop() || '';
      for (const line of lines) processYtDlpLine(line.trim(), false);
    });

    let stderrLineBuffer = '';
    process.stderr.on('data', (data) => {
      const errorStr = data.toString();
      errorOutput += errorStr;
      stderrLineBuffer += errorStr;
      const lines = stderrLineBuffer.split(/[\r\n]+/);
      stderrLineBuffer = lines.pop() || '';
      for (const line of lines) processYtDlpLine(line.trim(), true);
    });

    process.on('close', (code) => {
      activeDownloadProcess = null;
      if (resolved) return;
      resolved = true;

      const hasFfmpegError = errorOutput.includes('ERROR: ffmpeg exited with code');
      
      if (code === 0 && !hasFfmpegError) {
        console.log('✓ Download selesai');
        resolve({
          success: true,
          message: 'Download selesai',
          status: 'Selesai'
        });
      } else if (code === null) {
        reject(new Error('Download dibatalkan'));
      } else {
        if (errorOutput.includes('Requested format is not available')) {
          reject(new Error(`Format error: Quality "${quality}" tidak tersedia untuk video ini.\n\nCoba:\n- Refresh metadata\n- Pilih quality berbeda\n- Update yt-dlp: pip install --upgrade yt-dlp`));
        } else if (errorOutput.includes('Sign in')) {
          reject(new Error(`Authentication error: Video memerlukan login.\n\nSOLUSI:\n1. Buka Settings (ikon gerigi di pojok kiri atas).\n2. Pilih browser yang Anda gunakan untuk login YouTube (misal Chrome atau Firefox).\n3. Klik Simpan dan coba lagi.\n\n(Jika opsi Chrome error, gunakan file cookies.txt)`));
        } else if (errorOutput.includes('Instagram sent an empty media response') || errorOutput.includes('Unexpected response from webpage request') || errorOutput.includes('Login required') || errorOutput.toLowerCase().includes('login')) {
          reject(new Error(`Multiplatform Login Required\n\nInstagram / TikTok memblokir akses bot.\n\nSOLUSI (Bypass Cookies):\n1. Pastikan Anda sudah login akun IG/TikTok di browser.\n2. Buka menu Settings (Ikon Gerigi) di FytX.\n3. Pilih nama browser yang Anda gunakan (misal: Firefox).\n4. Jika opsi browser gagal, barulah gunakan file cookies.txt.`));
        } else if (hasFfmpegError || errorOutput.includes('403 Forbidden')) {
          reject(new Error(`Gagal Memotong Video: YouTube memblokir akses potong video untuk resolusi/format tinggi (403 Forbidden).\n\nSolusi (Win-Win):\nUntuk format 1440p/2160p (WebM), kamu wajib mendownload FULL VIDEO terlebih dahulu, barulah fitur trimmer bisa digunakan tanpa error.`));
        } else {
          reject(new Error(`yt-dlp error (code ${code}):\n${errorOutput.substring(0, 500)}`));
        }
      }
    });

    process.on('error', (err) => {
      activeDownloadProcess = null;
      if (resolved) return;
      resolved = true;
      reject(new Error(`Gagal menjalankan yt-dlp: ${err.message}`));
    });
  });
}

/**
 * Batalkan proses download yang sedang berjalan
 * @returns {boolean}
 */
function cancelDownload() {
  if (activeDownloadProcess) {
    console.log('Canceling the download...');
    activeDownloadProcess.kill('SIGKILL');
    activeDownloadProcess = null;
    return true;
  }
  return false;
}

module.exports = {
  isYtDlpInstalled,
  fetchMetadata,
  downloadMedia,
  cancelDownload,
  getCookieArgs
};
