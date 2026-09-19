/**
 * Shopee Video Service
 * Resolver custom buat link Shopee Video (sv.shopee.co.id/share-video/... , id.shp.ee/... , dll)
 * karena yt-dlp gak support platform ini.
 *
 * Video URL-nya ketanem di HTML halaman dalam bentuk JSON, di dalem script tag
 * <script id="__NEXT_DATA__">, path: props.pageProps.mediaInfo.video.watermarkVideoUrl
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

function isShopeeVideoUrl(url) {
  return /(^|\.)sv\.shopee\.|shopee\.co\.id\/.*video|shp\.ee\//i.test(url);
}

async function fetchHtml(url) {
  const { data } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml'
    },
    maxRedirects: 10
  });
  return data;
}

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    return null;
  }
}

async function fetchMetadata(url) {
  const html = await fetchHtml(url);
  const nextData = extractNextData(html);

  if (!nextData) {
    throw new Error('Gagal parse data video Shopee. Struktur halaman mungkin berubah.');
  }

  const pageProps = nextData.props && nextData.props.pageProps;
  const video = pageProps && pageProps.mediaInfo && pageProps.mediaInfo.video;

  if (!video || !video.watermarkVideoUrl) {
    throw new Error('URL video tidak ditemukan di data halaman Shopee.');
  }

  const uploader = (pageProps.mediaInfo.userInfo && pageProps.mediaInfo.userInfo.videoUserName) || 'Unknown';
  const caption = video.caption && video.caption.trim() ? video.caption.trim() : `${uploader}_ShopeeVideo`;
  const cleanTitle = caption.replace(/[^\w\s\-\.\(\)\[\]~]/g, '').trim().replace(/\s+/g, ' ') || 'Shopee_Video';

  return {
    title: cleanTitle,
    thumbnail: video.watermarkCoverUrl || null,
    duration: video.duration ? Math.round(video.duration / 1000) : 0,
    uploader,
    formats: {
      video: [{ format_id: 'direct', resolution: 'source', height: null, fps: 30, vcodec: 'h264', acodec: 'aac', ext: 'mp4', url: video.watermarkVideoUrl }],
      audio: []
    },
    previewUrl: video.watermarkVideoUrl,
    previewAudioUrl: null,
    userAgent: null,
    rawFormatCount: 1
  };
}

async function downloadDirect(url, downloadDir, title, onProgress) {
  const metadata = await fetchMetadata(url);
  const videoUrl = metadata.previewUrl;
  if (!videoUrl) throw new Error('URL video Shopee tidak ditemukan');

  const safeTitle = (title || metadata.title || 'Shopee_Video')
    .replace(/[^\w\s\-\.\(\)\[\]~]/g, '').trim().replace(/\s+/g, ' ') || 'Shopee_Video';
  const outPath = path.join(downloadDir, `${safeTitle}.mp4`);

  const response = await axios.get(videoUrl, { responseType: 'stream' });
  const totalLength = parseInt(response.headers['content-length'] || '0', 10);
  let downloaded = 0;

  const writer = fs.createWriteStream(outPath);
  response.data.on('data', (chunk) => {
    downloaded += chunk.length;
    if (onProgress && totalLength) {
      onProgress({ progress: parseFloat(((downloaded / totalLength) * 100).toFixed(1)), speed: null, eta: null, status: 'Mendownload video Shopee...' });
    }
  });

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', () => {
      if (onProgress) onProgress({ progress: 100, speed: null, eta: null, status: 'Selesai' });
      resolve({ success: true, message: 'Download selesai', status: 'Selesai', filePath: outPath });
    });
    writer.on('error', reject);
    response.data.on('error', reject);
  });
}

module.exports = { isShopeeVideoUrl, fetchMetadata, downloadDirect };