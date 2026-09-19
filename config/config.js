/**
 * Application Configuration
 * 
 * Centralized configuration untuk MediaFetch
 */

const path = require('path');
const helpers = require('../utils/helpers');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
  // Server Configuration
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || 'localhost',
    env: process.env.NODE_ENV || 'development',
    corsEnabled: process.env.CORS_ENABLED !== 'false'
  },

  // Paths
  paths: {
    root: path.join(__dirname, '..'),
    downloads: process.env.DOWNLOAD_DIR || path.join(__dirname, '..', 'downloads'),
    clips: path.join(__dirname, '..', 'downloads', 'clips'), // Subfolder for heatmap clips
    trim: path.join(__dirname, '..', 'downloads', 'trim'), // Subfolder for remote trimmed video
    cache: path.join(__dirname, '..', 'cache'),              // For sprites, thumbnails, temp files
    logs: path.join(__dirname, '..', 'logs'),
    public: path.join(__dirname, '..', 'public')
  },

  // yt-dlp Configuration
  ytdlp: {
    path: process.env.YT_DLP_PATH || 'yt-dlp',
    quiet: process.env.YTDLP_QUIET === 'true',
    noWarnings: process.env.YTDLP_NO_WARNINGS !== 'false',
    timeout: 30000, // 30 seconds
    maxRetries: 3
  },

  // ffmpeg Configuration
  ffmpeg: {
    path: process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
    timeout: 60000, // 60 seconds
    defaultAudioBitrate: process.env.AUDIO_BITRATE || '192k'
  },

  // Download Configuration
  download: {
    maxSize: (process.env.MAX_DOWNLOAD_SIZE || 5000) * 1024 * 1024, // Convert to bytes
    timeout: 600000, // 10 minutes
    retries: 2
  },

  // Platform Support
  supportedPlatforms: (process.env.SUPPORTED_PLATFORMS || 'youtube,instagram,tiktok,facebook,twitter,reddit,vimeo').split(','),

  // Logging
  logging: {
    enabled: true,
    level: process.env.LOG_LEVEL || 'info',
    logFile: process.env.LOG_FILE || 'app.log'
  },

  // Rate Limiting
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED === 'true',
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || 100),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 900000)
  },

  // Feature Flags
  features: {
    videoDownload: true,
    audioDownload: true,
    metadataFetch: true,
    thumbnailPreview: true,
    progressTracking: true
  },

  // Audio Bitrate Options
  audioBitrates: [
    { value: '128k', label: '128 kbps (Standar)' },
    { value: '192k', label: '192 kbps (Baik)' },
    { value: '256k', label: '256 kbps (Sangat Baik)' },
    { value: '320k', label: '320 kbps (Terbaik)' }
  ],

  // Video Quality Map
  videoQualities: {
    '360p': { height: 360, label: 'Low Quality' },
    '480p': { height: 480, label: 'Standard' },
    '720p': { height: 720, label: 'HD' },
    '1080p': { height: 1080, label: 'Full HD' },
    '1440p': { height: 1440, label: '2K' },
    '2160p': { height: 2160, label: '4K' }
  }
};

// Validate configuration
function validateConfig() {
  const errors = [];

  // Check required paths
  if (!config.paths.downloads) {
    errors.push('Download directory path is required');
  }

  // Check yt-dlp
  if (!helpers.commandExists(config.ytdlp.path)) {
    errors.push(`yt-dlp tidak ditemukan. Install dengan: pip install yt-dlp`);
  }

  // Check ffmpeg
  if (!helpers.commandExists(config.ffmpeg.path)) {
    errors.push(`ffmpeg tidak ditemukan. Lihat README untuk panduan instalasi`);
  }

  if (errors.length > 0) {
    console.error('\nConfiguration Validation Errors:');
    errors.forEach(err => console.error(`   - ${err}`));
    console.error('\nHarap fix errors di atas sebelum melanjutkan.\n');
    process.exit(1);
  }
}

// Get environment-specific config
function getEnvConfig() {
  if (config.server.env === 'production') {
    return {
      logging: { enabled: true, level: 'warn' },
      rateLimit: { enabled: true, maxRequests: 50, windowMs: 900000 }
    };
  }

  return {
    logging: { enabled: true, level: 'debug' },
    rateLimit: { enabled: false }
  };
}

// Merge environment-specific config
const envConfig = getEnvConfig();
config.logging = helpers.deepMerge(config.logging, envConfig.logging);
config.rateLimit = helpers.deepMerge(config.rateLimit, envConfig.rateLimit);

module.exports = {
  config,
  validateConfig,
  getConfig: () => config
};
