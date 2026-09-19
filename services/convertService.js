/**
 * Convert Service
 * 
 * Service untuk convert audio/video menggunakan ffmpeg
 * Fitur: convert ke mp3, optimize video quality
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const toolPaths = require('../utils/toolPaths');

/**
 * Cek apakah ffmpeg sudah terinstall
 * @returns {boolean}
 */
function isFfmpegInstalled() {
  try {
    execSync(`"${toolPaths.ffmpeg}" -version`, { stdio: 'pipe' });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Convert audio ke MP3
 * @param {string} inputFile - Path file input
 * @param {string} outputFile - Path file output (mp3)
 * @param {string} bitrate - Bitrate audio (contoh: 128k, 192k, 320k)
 * @param {Function} onProgress - Callback untuk progress
 * @returns {Promise<Object>}
 */
async function convertToMp3(inputFile, outputFile, bitrate = '192k', onProgress) {
  return new Promise((resolve, reject) => {
    if (!isFfmpegInstalled()) {
      reject(new Error('ffmpeg belum terinstall'));
    }

    if (!fs.existsSync(inputFile)) {
      reject(new Error(`File input tidak ditemukan: ${inputFile}`));
    }

    console.log(`🔄 Converting to MP3: ${path.basename(inputFile)} (bitrate: ${bitrate})`);

    const args = [
      '-i', inputFile,
      '-q:a', '0',
      '-map', 'a',
      '-b:a', bitrate,
      '-y', // Overwrite output file
      outputFile
    ];

    let errorOutput = '';

    const process = spawn(toolPaths.ffmpeg, args);

    process.stderr.on('data', (data) => {
      const dataStr = data.toString();
      errorOutput += dataStr;

      // Parse progress dari ffmpeg
      // Format: Duration: 00:03:45.50, start: 0.000000, bitrate: 192 kb/s
      // Progress=frame=  425 fps= 50 q=28.0 Lsize= ...
      const match = dataStr.match(/Duration: (\d+):(\d+):(\d+)/);
      const progressMatch = dataStr.match(/time=(\d+):(\d+):(\d+)/);

      if (progressMatch) {
        const totalSeconds = match 
          ? parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3])
          : 100;
        
        const currentSeconds = parseInt(progressMatch[1]) * 3600 + 
                              parseInt(progressMatch[2]) * 60 + 
                              parseInt(progressMatch[3]);
        
        const progress = Math.min((currentSeconds / totalSeconds) * 100, 100);
        
        if (onProgress) {
          onProgress({
            progress: Math.round(progress),
            status: 'Mengkonversi ke MP3...'
          });
        }
      }
    });

    process.on('close', (code) => {
      if (code === 0) {
        if (fs.existsSync(outputFile)) {
          console.log(`✓ Konversi selesai: ${path.basename(outputFile)}`);
          
          // Hapus file input jika berhasil
          try {
            fs.unlinkSync(inputFile);
          } catch (err) {
            console.warn(`Gagal menghapus file temporary: ${inputFile}`);
          }

          resolve({
            success: true,
            outputFile: outputFile,
            message: 'Konversi ke MP3 selesai'
          });
        } else {
          reject(new Error('File output tidak ditemukan setelah konversi'));
        }
      } else {
        reject(new Error(`ffmpeg error: ${errorOutput}`));
      }
    });

    process.on('error', (err) => {
      reject(new Error(`Gagal menjalankan ffmpeg: ${err.message}`));
    });
  });
}

/**
 * Get durasi file audio/video
 * @param {string} filePath - Path file
 * @returns {Promise<number>} - Durasi dalam detik
 */
async function getMediaDuration(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      reject(new Error(`File tidak ditemukan: ${filePath}`));
    }

    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1:nokey_line=1',
      filePath
    ];

    let output = '';

    const process = spawn(toolPaths.ffprobe, args);

    process.stdout.on('data', (data) => {
      output += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0) {
        const duration = parseFloat(output.trim());
        resolve(duration);
      } else {
        reject(new Error('Gagal mendapatkan durasi media'));
      }
    });

    process.on('error', (err) => {
      reject(new Error(`Gagal menjalankan ffprobe: ${err.message}`));
    });
  });
}

module.exports = {
  isFfmpegInstalled,
  convertToMp3,
  getMediaDuration
};
