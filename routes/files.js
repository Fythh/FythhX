const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const { config } = require('../config/config');

router.get('/files', (req, res) => {
  try {
    const folders = [
      { name: 'Full Downloads', path: config.paths.downloads, prefix: '/downloads/' },
      { name: 'Trim', path: config.paths.trim, prefix: '/downloads/trim/' },
      { name: 'Clips', path: config.paths.clips, prefix: '/downloads/clips/' },
      { name: 'Dead Air Cuts', path: config.paths.dead_air, prefix: '/downloads/dead_air/' }
    ];

    const allFiles = [];
    const skippedFiles = [];
    const debugErrors = [];

    folders.forEach(folder => {
      if (fs.existsSync(folder.path)) {
        const files = fs.readdirSync(folder.path);
        files.forEach(f => {
          // Hanya file media, abaikan folder
          const fullPath = path.join(folder.path, f);
          try {
            const stat = fs.statSync(fullPath);
            const ext = f.toLowerCase();
            if (stat.isFile() && (ext.endsWith('.mp4') || ext.endsWith('.mp3') || ext.endsWith('.mkv') || ext.endsWith('.webm') || ext.endsWith('.m4a') || ext.endsWith('.wav'))) {
              allFiles.push({
                name: f,
                category: folder.name,
                url: folder.prefix + encodeURIComponent(f),
                size: stat.size,
                date: stat.mtime
              });
            } else {
              skippedFiles.push({ name: f, isFile: stat.isFile(), ext: ext });
            }
          } catch (err) {
            console.error('Failed to stat file:', fullPath, err.message);
            debugErrors.push({ path: fullPath, error: err.message });
            
            // GRACEFUL FALLBACK: Jika Windows gagal melakukan stat karena bug emoji/Unicode,
            // tetap masukkan filenya ke dalam list agar user bisa melihat dan menghapusnya dari UI.
            const ext = f.toLowerCase();
            if (ext.endsWith('.mp4') || ext.endsWith('.mp3') || ext.endsWith('.mkv') || ext.endsWith('.webm') || ext.endsWith('.m4a') || ext.endsWith('.wav')) {
              allFiles.push({
                name: f,
                category: folder.name,
                url: folder.prefix + encodeURIComponent(f),
                size: 0,
                date: new Date()
              });
            }
          }
        });
      } else {
        debugErrors.push({ path: folder.path, error: 'Directory does not exist' });
      }
    });

    // Urutkan dari yang paling baru
    allFiles.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ ok: true, files: allFiles, debug_skipped: skippedFiles, debug_errors: debugErrors });
  } catch (error) {
    console.error('File fetch error:', error);
    res.json({ ok: false, error: error.message });
  }
});

router.delete('/files', (req, res) => {
  try {
    const fileUrl = req.query.url;
    if (!fileUrl) return res.status(400).json({ ok: false, error: 'No URL provided' });

    const folders = [
      { path: config.paths.downloads, prefix: '/downloads/' },
      { path: config.paths.trim, prefix: '/downloads/trim/' },
      { path: config.paths.clips, prefix: '/downloads/clips/' },
      { path: config.paths.dead_air, prefix: '/downloads/dead_air/' }
    ];

    let targetPath = null;

    // Cek prefix yang paling panjang dulu (e.g. /downloads/trim/ sebelum /downloads/)
    const sortedFolders = folders.sort((a, b) => b.prefix.length - a.prefix.length);

    for (const folder of sortedFolders) {
      if (fileUrl.startsWith(folder.prefix)) {
        const filename = decodeURIComponent(fileUrl.substring(folder.prefix.length));
        targetPath = path.join(folder.path, filename);
        
        // Mencegah Directory Traversal
        const normalizedTarget = path.normalize(targetPath);
        const normalizedFolder = path.normalize(folder.path);
        if (!normalizedTarget.startsWith(normalizedFolder)) {
            return res.status(403).json({ ok: false, error: 'Invalid file path' });
        }
        break;
      }
    }

    if (targetPath && fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
      res.json({ ok: true });
    } else {
      res.status(404).json({ ok: false, error: 'File not found' });
    }
  } catch (error) {
    console.error('File delete error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.post('/open-folder', (req, res) => {
  try {
    const { type, filename } = req.body;
    let targetPath = config.paths.downloads;
    if (type === 'trim') targetPath = config.paths.trim;
    else if (type === 'clips') targetPath = config.paths.clips;
    else if (type === 'dead_air') targetPath = config.paths.dead_air;
    
    if (filename) {
      const filePath = path.join(targetPath, filename);
      if (fs.existsSync(filePath)) {
        require('child_process').exec(`explorer.exe /select,"${filePath}"`);
        return res.json({ ok: true });
      }
    }

    if (fs.existsSync(targetPath)) {
      require('child_process').exec(`explorer.exe "${targetPath}"`);
      res.json({ ok: true });
    } else {
      res.status(404).json({ ok: false, error: 'Folder not found' });
    }
  } catch (err) {
    console.error('Open folder error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
