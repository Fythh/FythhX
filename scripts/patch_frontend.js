const fs = require('fs');
let code = fs.readFileSync('public/clipper.js', 'utf8');

// 1. Define UI elements
const elTarget = `const clipperStartBtn = document.getElementById('clipperStartBtn');`;
const elReplace = `const clipperDraftBtn = document.getElementById('clipperDraftBtn');
  const subtitleModal = document.getElementById('subtitleModal');
  const closeSubtitleModal = document.getElementById('closeSubtitleModal');
  const saveSubtitleBtn = document.getElementById('saveSubtitleBtn');
  const subtitleEditorContainer = document.getElementById('subtitleEditorContainer');
  let currentDraftSubtitleData = null; // Store edited JSON here
  let currentDraftSegment = null; // Store segment to render later
  
  const clipperStartBtn = document.getElementById('clipperStartBtn');`;
if(code.includes(elTarget)) code = code.replace(elTarget, elReplace);

// 2. Add Event listeners
const listenTarget = `clipperStartBtn.addEventListener('click', handleStartClip);`;
const listenReplace = `clipperStartBtn.addEventListener('click', handleStartClip);
  if(clipperDraftBtn) clipperDraftBtn.addEventListener('click', handleDraftSubtitle);
  if(closeSubtitleModal) closeSubtitleModal.addEventListener('click', () => subtitleModal.classList.add('hidden', 'opacity-0'));
  if(saveSubtitleBtn) saveSubtitleBtn.addEventListener('click', handleSaveSubtitleAndRender);
`;
if(code.includes(listenTarget)) code = code.replace(listenTarget, listenReplace);

// 3. Add Draft logic
const draftLogic = `
  async function handleDraftSubtitle() {
    if (clipperVideoId.value.trim() === '') return alert('Masukkan Link YouTube terlebih dahulu!');
    const boxes = document.querySelectorAll('.hm-chunk-checkbox:checked');
    if (boxes.length === 0) return alert('Pilih minimal satu segmen Heatmap!');
    
    // For MVP Subtitle Editor, we only support generating 1 segment at a time for draft
    const box = boxes[0];
    const segment = {
      start: parseFloat(box.dataset.start),
      duration: parseFloat(box.dataset.duration)
    };
    currentDraftSegment = segment;
    
    // UI Loading state
    clipperProgressPanel.classList.remove('hidden');
    clipperProgressBar.style.width = '0%';
    clipperProgressText.textContent = 'Membuat draft teks subtitle... (Bisa butuh 1-2 menit tergantung spek)';
    clipperLogsContainer.innerHTML = '<div>Mengekstrak audio dan menjalankan AI...</div>';
    clipperStartBtn.disabled = true;
    clipperDraftBtn.disabled = true;
    
    try {
        const payload = {
            videoId: clipperVideoId.value.trim(),
            start: segment.start,
            duration: segment.duration,
            whisperModel: clipperWhisperModel.value
        };
        const res = await fetch('/api/clipper/draft-subtitle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const d = await res.json();
        
        if (!d.ok) throw new Error(d.error || 'Gagal generate draft');
        
        currentDraftSubtitleData = d.data;
        renderSubtitleEditor(d.data);
        
        // Show modal
        subtitleModal.classList.remove('hidden');
        setTimeout(() => subtitleModal.classList.remove('opacity-0'), 50);
        
        clipperProgressText.textContent = 'Teks Subtitle Siap Dikoreksi!';
    } catch (err) {
        alert(err.message);
        clipperProgressText.textContent = 'Gagal: ' + err.message;
    } finally {
        clipperStartBtn.disabled = false;
        clipperDraftBtn.disabled = false;
    }
  }

  function renderSubtitleEditor(data) {
      subtitleEditorContainer.innerHTML = '';
      if (!data || !data.segments) return;
      
      data.segments.forEach((seg, i) => {
          const row = document.createElement('div');
          row.className = 'flex flex-col gap-1 border-b border-white/5 pb-2 mb-2';
          
          const timeLabel = document.createElement('div');
          timeLabel.className = 'text-xs text-primary font-mono';
          timeLabel.textContent = \`[\${seg.start.toFixed(1)}s - \${seg.end.toFixed(1)}s]\`;
          
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-primary outline-none';
          input.value = seg.text.trim();
          input.dataset.index = i;
          
          input.addEventListener('input', (e) => {
              const idx = parseInt(e.target.dataset.index);
              currentDraftSubtitleData.segments[idx].text = e.target.value;
              // Also update words array if possible, but ASS builder usually uses words for karaoke. 
              // To make it simple, we just overwrite the segment text. The backend ASS generator can fall back to segment text if words don't match.
          });
          
          row.appendChild(timeLabel);
          row.appendChild(input);
          subtitleEditorContainer.appendChild(row);
      });
  }

  function handleSaveSubtitleAndRender() {
      subtitleModal.classList.add('hidden', 'opacity-0');
      // Programmatically trigger handleStartClip but pass the custom JSON
      handleStartClip(null, true);
  }
`;

// Inject before handleStartClip
const startTarget = `async function handleStartClip() {`;
if(code.includes(startTarget)) {
    code = code.replace(startTarget, draftLogic + '\n  async function handleStartClip(e, isFromDraft = false) {');
}

// Inside handleStartClip, inject customSubtitleJson
// `whisperModel: clipperWhisperModel.value,`
const modelTarget = `whisperModel: clipperWhisperModel.value,`;
const modelReplace = `whisperModel: clipperWhisperModel.value,
            customSubtitleJson: isFromDraft && currentDraftSubtitleData ? JSON.stringify(currentDraftSubtitleData) : null,`;
if(code.includes(modelTarget)) {
    code = code.replace(modelTarget, modelReplace);
}

// In loop for segments: only process 1 segment if from draft
const loopTarget = `for (let i = 0; i < boxes.length; i++) {`;
const loopReplace = `for (let i = 0; i < (isFromDraft ? 1 : boxes.length); i++) {`;
if(code.includes(loopTarget)) {
    code = code.replace(loopTarget, loopReplace);
}

fs.writeFileSync('public/clipper.js', code, 'utf8');
console.log('clipper.js updated!');
