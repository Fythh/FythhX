const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { config } = require('../config/config');
const jobManager = require('../utils/jobManager');

// Keep track of running processes for cancellation
const activeProcesses = new Map();

router.get('/deadair/browse', (req, res) => {
  const pythonScript = `
import tkinter as tk
from tkinter import filedialog
import sys

try:
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    file_path = filedialog.askopenfilename(
        title='Pilih Video Raw',
        filetypes=[('Video Files', '*.mp4 *.mkv *.avi *.mov *.ts'), ('All Files', '*.*')]
    )
    print(file_path)
except Exception as e:
    pass
  `;
  
  const pyProcess = spawn('python', ['-c', pythonScript]);
  
  let output = '';
  pyProcess.stdout.on('data', (data) => output += data.toString());
  
  pyProcess.on('close', () => {
    res.json({ path: output.trim() });
  });
});

router.post('/deadair/start', (req, res) => {
  const { inputPath, silenceDb, minSilence } = req.body;
  
  if (!inputPath || !fs.existsSync(inputPath)) {
    return res.json({ ok: false, error: 'Input file not found / Invalid Path' });
  }

  const db = silenceDb || -35;
  const minSil = minSilence || 0.2;
  const jobId = `deadair_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  
  const job = {
    id: jobId,
    status: 'running',
    progress: 0,
    logs: [],
    outputs: [],
    createdAt: new Date(),
  };
  
  jobManager.set(jobId, job);
  
  // Output dir is downloads/dead_air
  const outputDir = config.paths.dead_air;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  job.logs.push(`[System] Memulai Dead Air Auto Cut...`);
  job.logs.push(`[System] Input: ${inputPath}`);
  job.logs.push(`[System] Silence Threshold: ${db} dB`);
  job.logs.push(`[System] Silence Gap: ${minSil} sec`);
  job.logs.push(`[System] Output Directory: ${outputDir}`);

  const pyScript = path.join(__dirname, '..', 'scripts', 'scripts.py');
  
  const args = [
    pyScript,
    inputPath,
    '--silence-db', db.toString(),
    '--min-silence', minSil.toString(),
    '--output', outputDir
  ];

  const pyProcess = spawn('python', args, { 
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  });
  activeProcesses.set(jobId, pyProcess);

  pyProcess.stdout.on('data', (data) => {
    const text = data.toString();
    const lines = text.split('\n');
    for (const line of lines) {
      const clean = line.replace(/\r/g, '').trim();
      if (clean) {
        job.logs.push(clean);
        // Extract progress if possible
        const progressMatch = clean.match(/Progress Render: \[([\d.]+)%\]/);
        if (progressMatch) {
          job.progress = parseFloat(progressMatch[1]);
        }
      }
    }
  });

  pyProcess.stderr.on('data', (data) => {
     const text = data.toString();
     const lines = text.split('\n');
     for (const line of lines) {
       const clean = line.replace(/\r/g, '').trim();
       if (clean) {
           if (clean.includes('time=')) {
              // It's ffmpeg progress, ignore to avoid spam
           } else {
              job.logs.push(`[Stderr] ${clean}`);
           }
       }
     }
  });

  pyProcess.on('close', (code) => {
    activeProcesses.delete(jobId);
    if (code === 0) {
      job.status = 'done';
      job.progress = 100;
      job.logs.push(`[System] Proses selesai dengan sukses.`);
      
      // Auto open explorer to the output dir
      try {
        require('child_process').exec(`explorer.exe "${outputDir}"`);
      } catch(e) {}
    } else {
      if (job.status !== 'cancelled') {
        job.status = 'error';
        job.logs.push(`[System] Proses gagal dengan kode error: ${code}`);
      }
    }
  });

  res.json({ ok: true, jobId });
});

router.get('/deadair/job/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobManager.get(jobId);
  if (!job) return res.json({ ok: false, error: 'Job not found' });
  res.json({ ok: true, job });
});

router.post('/deadair/cancel/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobManager.get(jobId);
  if (!job) return res.json({ ok: false, error: 'Job not found' });
  
  const proc = activeProcesses.get(jobId);
  if (proc) {
    try {
      require('child_process').exec(`taskkill /pid ${proc.pid} /t /f`);
    } catch(e) {
      proc.kill('SIGKILL');
    }
    activeProcesses.delete(jobId);
  }
  
  job.status = 'cancelled';
  job.logs.push('[System] Proses dibatalkan oleh pengguna.');
  res.json({ ok: true });
});

module.exports = router;
