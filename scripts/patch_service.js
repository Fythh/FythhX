const fs = require('fs');
let code = fs.readFileSync('services/clipperService.js', 'utf8');

// We need to export a new function generateDraftSubtitle
// We also need to modify processClip to support opts.customSubtitleJson

const exportTarget = `module.exports = {
  scanHeatmap,
  getVideoInfo,
  processClip,
  checkPythonDeps,
  cancelJobProcesses
};`;

const exportReplacement = `async function generateDraftSubtitle(opts) {
  const { videoId, segment, deps, whisperModel, jobId, onLog } = opts;
  const path = require('path');
  const { spawn } = require('child_process');
  const tempFile = path.join(__dirname, '..', 'downloads', \`temp_draft_\${jobId}.mp4\`);
  
  if (onLog) onLog('[System] Mendownload segmen audio untuk Draft Subtitle...');
  const startSec = Math.max(0, segment.start - 0.5);
  const endSec = segment.start + segment.duration + 0.5;
  const ytdlpArgs = [
    '--js-runtimes', 'node',
    '-f', 'ba[ext=m4a]/b',
    '--download-sections', \`*\${startSec}-\${endSec}\`,
    '--force-overwrites',
    '--output', tempFile,
    \`https://www.youtube.com/watch?v=\${videoId}\`
  ];
  
  await new Promise((res, rej) => {
      const proc = spawn('yt-dlp', ytdlpArgs);
      if (jobId) {
          const { registerProcess } = require('./clipperService'); // self ref
          // Actually registerProcess is inside clipperService but not exported, let's skip for draft
      }
      proc.on('close', (c) => {
          if (c !== 0) return rej(new Error('Gagal download audio draft'));
          res();
      });
  });

  if (onLog) onLog('[System] Mengekstrak audio...');
  const wavFile = tempFile.replace('.mp4', '.wav').replace('.m4a', '.wav');
  await new Promise((res) => {
      const ffmpeg = spawn('ffmpeg', ['-y', '-i', tempFile, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', wavFile]);
      ffmpeg.on('close', () => res());
  });

  if (onLog) onLog('[System] Menjalankan AI Whisper...');
  const pythonScript = path.join(__dirname, '..', 'scripts', 'generate_subtitle.py');
  const jsonPath = tempFile.replace('.mp4', '.json').replace('.m4a', '.json');
  
  await new Promise((res, rej) => {
      const py = spawn('python', [pythonScript, fs.existsSync(wavFile) ? wavFile : tempFile, jsonPath, whisperModel || 'small'], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      
      py.stdout.on('data', d => { if (onLog) onLog('[Whisper] ' + d.toString().trim()); });
      py.stderr.on('data', d => { if (onLog) onLog('[Whisper] ' + d.toString().trim()); });
      
      py.on('close', (c) => {
          if (fs.existsSync(wavFile)) fs.unlinkSync(wavFile);
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
          
          if (c !== 0) return rej(new Error('Whisper gagal'));
          res();
      });
  });

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  return data;
}

module.exports = {
  scanHeatmap,
  getVideoInfo,
  processClip,
  checkPythonDeps,
  cancelJobProcesses,
  generateDraftSubtitle
};`;

code = code.replace(exportTarget, exportReplacement);

// Now patch processClip to use customSubtitleJson
// Find `if (doSubtitle) { p = new Promise...`
const subTarget = `          if (doSubtitle) {
            p = new Promise((resolve, reject) => {
              const pythonScript = path.join(__dirname, '..', 'scripts', 'generate_subtitle.py');`;

const subReplace = `          if (doSubtitle && opts.customSubtitleJson) {
            p = Promise.resolve().then(() => {
                if (onLog) onLog('[System] Menggunakan teks subtitle hasil editan kustom...');
                const jsonPath = tempFile.replace('.mp4', '.json');
                fs.writeFileSync(jsonPath, opts.customSubtitleJson, 'utf8');
                return jsonPath;
            });
          } else if (doSubtitle) {
            p = new Promise((resolve, reject) => {
              const pythonScript = path.join(__dirname, '..', 'scripts', 'generate_subtitle.py');`;

code = code.replace(subTarget, subReplace);

fs.writeFileSync('services/clipperService.js', code, 'utf8');
console.log('clipperService patched!');
