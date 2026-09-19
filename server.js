/**
 * MediaFetch - Server Utama
 * 
 * Aplikasi web lokal untuk mendownload video/audio dari YouTube, Instagram, TikTok, M
 * Tech Stack: Node.js + Express
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

// Import routes
const fetchRoutes = require('./routes/fetch');
const downloadRoutes = require('./routes/download');
const cancelRoutes = require('./routes/cancel');
const clipperRoutes = require('./routes/clipper');
const proxyRoutes = require('./routes/proxy');

const filesRoutes = require('./routes/files');
const thumbnailRoutes = require('./routes/thumbnails');

// Inisialisasi Express app
const app = express();
const PORT = process.env.PORT || 8080;

// ==========================================
// SISTEM LISENSI
// ==========================================
const licenseService = require('./services/licenseService');
const licenseStatus = licenseService.verifyLicense();

if (!licenseStatus.valid) {
    // Jika lisensi tidak valid, jangan jalankan API utama.
    // Alihkan semua request ke halaman peringatan Lisensi.
    app.get('*', (req, res) => {
        res.send(`
            <div style="font-family: sans-serif; padding: 40px; text-align: center; color: white; background: #1a1a1a; min-height: 100vh;">
                <h1 style="color: #ff4444;">Akses Ditolak: Lisensi Tidak Valid</h1>
                <p>${licenseStatus.reason}</p>
                <div style="margin: 30px auto; padding: 20px; background: #000; border-radius: 8px; max-width: 500px;">
                    <p style="margin: 0; color: #888;">Hardware ID Anda:</p>
                    <h2 style="margin: 10px 0; color: #4cd7f6; user-select: all;">${licenseStatus.hwid}</h2>
                </div>
                <p>Silakan *copy* Hardware ID di atas dan hubungi Admin untuk membeli / mengaktifkan lisensi.</p>
                <p>Setelah mendapatkan file <b>license.key</b>, letakkan di folder yang sama dengan file .exe ini dan jalankan ulang.</p>
            </div>
        `);
    });
    
    app.listen(PORT, () => {
        console.log(`[LICENSE BLOCKED] Menunggu lisensi... Buka http://localhost:${PORT}`);
    });
    return; // Hentikan eksekusi script selanjutnya!
}
// ==========================================

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const { config } = require('./config/config');

// Buat struktur folder secara otomatis jika belum ada
const directoriesToCreate = [
  config.paths.downloads,
  config.paths.clips,
  config.paths.trim,
  config.paths.cache,
  config.paths.logs
];

directoriesToCreate.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Folder berhasil dibuat: ${dir}`);
  }
});


// Routes
app.use('/api', fetchRoutes);
app.use('/api', downloadRoutes);
app.use('/api', cancelRoutes);
app.use('/api', clipperRoutes);
app.use('/api', proxyRoutes);
app.use('/api', filesRoutes);
app.use('/api', thumbnailRoutes);

// Serve static files

app.use('/downloads/trim', express.static(config.paths.trim));
app.use('/downloads/clips', express.static(config.paths.clips));
app.use('/downloads', express.static(config.paths.downloads));
app.use('/filmstrips', express.static(path.join(config.paths.cache, 'filmstrips')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'MediaFetch server is running' });
});

// Clear Cache endpoint
app.post('/api/clear-cache', (req, res) => {
  try {
    const cacheDir = config.paths.cache;
    if (fs.existsSync(cacheDir)) {
      const files = fs.readdirSync(cacheDir);
      for (const file of files) {
        const filePath = path.join(cacheDir, file);
        if (fs.lstatSync(filePath).isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(filePath);
        }
      }
    }
    // Create the sprite folder back so it doesn't break static serving
    const spritesDir = path.join(cacheDir, 'filmstrips');
    if (!fs.existsSync(spritesDir)) {
      fs.mkdirSync(spritesDir, { recursive: true });
    }
    res.json({ success: true, message: 'Cache cleared successfully' });
  } catch (err) {
    console.error('Error clearing cache:', err);
    res.status(500).json({ error: 'Gagal membersihkan cache' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  FythhX Server Started                                   ║ 
║                                                          ║
║  URL: http://localhost:${PORT}                           ║
║  Environment: ${process.env.NODE_ENV || 'development'}   ║
║                                                          ║
║  Tekan Ctrl+C untuk menghentikan server                  ║
╚══════════════════════════════════════════════════════════╝
  `);
});
