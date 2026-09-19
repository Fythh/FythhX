/**
 * Helper Utilities
 * 
 * Fungsi-fungsi helper untuk berbagai keperluan
 */

/**
 * Validasi URL
 * @param {string} url - URL yang akan divalidasi
 * @returns {boolean}
 */
function isValidUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch (err) {
    return false;
  }
}

/**
 * Get platform name dari URL
 * @param {string} url - URL
 * @returns {string|null}
 */
function getPlatformFromUrl(url) {
  if (!url) return null;

  const urlLower = url.toLowerCase();

  if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
    return 'youtube';
  } else if (urlLower.includes('instagram.com')) {
    return 'instagram';
  } else if (urlLower.includes('tiktok.com')) {
    return 'tiktok';
  } else if (urlLower.includes('facebook.com') || urlLower.includes('fb.com')) {
    return 'facebook';
  } else if (urlLower.includes('twitter.com') || urlLower.includes('x.com')) {
    return 'twitter';
  } else if (urlLower.includes('reddit.com')) {
    return 'reddit';
  } else if (urlLower.includes('vimeo.com')) {
    return 'vimeo';
  }

  return 'unknown';
}

/**
 * Format bytes ke readable format
 * @param {number} bytes - Jumlah bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format durasi (detik) ke HH:MM:SS
 * @param {number} seconds - Durasi dalam detik
 * @returns {string}
 */
function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '00:00:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const pad = (num) => String(num).padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  }
  return `${pad(minutes)}:${pad(secs)}`;
}

/**
 * Sanitize filename
 * @param {string} filename - Filename yang akan di-sanitize
 * @returns {string}
 */
function sanitizeFilename(filename) {
  // Hapus karakter invalid untuk filename
  return filename
    .replace(/[<>:"|?*]/g, '')          // Windows invalid chars
    .replace(/[\x00-\x1f]/g, '')         // Control characters
    .replace(/^\.+/, '')                 // Leading dots
    .replace(/\s+/g, ' ')                // Multiple spaces to single
    .trim()
    .substring(0, 200);                  // Limit length
}

/**
 * Get video quality label
 * @param {number} height - Tinggi video
 * @returns {string}
 */
function getQualityLabel(height) {
  if (!height) return 'Unknown';
  if (height >= 2160) return '4K (2160p)';
  if (height >= 1440) return '2K (1440p)';
  if (height >= 1080) return 'Full HD (1080p)';
  if (height >= 720) return 'HD (720p)';
  if (height >= 480) return 'SD (480p)';
  if (height >= 360) return 'Low (360p)';
  return `${height}p`;
}

/**
 * Sleep utility untuk async delay
 * @param {number} ms - Milliseconds
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry logic untuk network calls
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} delayMs - Delay between retries
 * @returns {Promise<any>}
 */
async function retryAsync(fn, maxRetries = 3, delayMs = 1000) {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < maxRetries - 1) {
        await sleep(delayMs * (i + 1)); // Exponential backoff
      }
    }
  }

  throw lastError;
}

/**
 * Check if command exists
 * @param {string} command - Command to check
 * @returns {boolean}
 */
function commandExists(command) {
  const { execSync } = require('child_process');
  try {
    execSync(`${command} --version`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Merge objects deeply
 * @param {Object} target - Target object
 * @param {Object} source - Source object
 * @returns {Object}
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      if (source[key] instanceof Object && !Array.isArray(source[key])) {
        result[key] = deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
  }

  return result;
}

/**
 * Extract resolution dari quality string
 * @param {string} qualityStr - Quality string (e.g., "720p")
 * @returns {number|null}
 */
function extractResolution(qualityStr) {
  if (!qualityStr) return null;
  const match = qualityStr.match(/(\d+)p/);
  return match ? parseInt(match[1]) : null;
}

module.exports = {
  isValidUrl,
  getPlatformFromUrl,
  formatBytes,
  formatDuration,
  sanitizeFilename,
  getQualityLabel,
  sleep,
  retryAsync,
  commandExists,
  deepMerge,
  extractResolution
};
