const fs = require('fs');
let text = fs.readFileSync('public/index.html', 'utf-8');

// 1. Add large-v2 and large-v3 options
const opt = '<option value="large">Large (Sangat Akurat)</option>';
const opt_new = opt + '\n                                    <option value="large-v2">Large V2 (Slang & Akurat)</option>\n                                    <option value="large-v3">Large V3 (Paling Mutakhir)</option>';
if (text.includes(opt)) {
    text = text.replace(opt, opt_new);
}

// 2. Add Draft button
const btn = '<button id="clipperStartBtn" class="flex-1 bg-gradient-to-r from-primary to-primary-container text-on-primary font-button text-[16px] py-3 rounded-xl flex items-center justify-center gap-2 glow-hover transition-all active:scale-[0.98]">';
const btn_new = `<button id="clipperDraftBtn" type="button" class="flex-1 bg-surface-variant text-on-surface font-button text-[14px] py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-white/10 transition-all active:scale-[0.98] border border-white/10" title="Buat teks subtitle dulu buat diedit sebelum dirender">
                            <span class="material-symbols-outlined text-[20px]">subtitles</span> 1. Generate Teks Subtitle
                          </button>\n                          ` + btn;
if (text.includes(btn)) {
    text = text.replace(btn, btn_new);
    text = text.replace('Mulai Generate', '2. Render Video');
}

// 3. Add Modal HTML at the end before </body>
const modal = `  <!-- Modal Subtitle Editor -->
  <div id="subtitleModal" class="fixed inset-0 bg-black/80 flex items-center justify-center z-[110] hidden opacity-0 transition-opacity duration-300 p-4 backdrop-blur-sm">
    <div class="bg-surface p-6 rounded-2xl w-full max-w-3xl border border-white/10 shadow-2xl relative flex flex-col h-[80vh]">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-xl font-bold text-on-surface">Koreksi Teks Subtitle</h3>
        <button id="closeSubtitleModal" class="text-white/50 hover:text-white transition-colors">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="bg-surface-variant rounded-xl p-4 flex-1 overflow-y-auto flex flex-col gap-2" id="subtitleEditorContainer">
        <!-- Subtitle items will be injected here -->
      </div>
      <div class="mt-4 flex justify-end gap-3">
        <button id="saveSubtitleBtn" class="bg-primary hover:bg-primary-hover text-on-primary font-bold py-2 px-6 rounded-lg transition-colors shadow-glow flex items-center gap-2">
            <span class="material-symbols-outlined">play_arrow</span> Render Final (Mulai)
        </button>
      </div>
    </div>
  </div>
`;
if (!text.includes('<!-- Modal Subtitle Editor -->')) {
    text = text.replace('</body>', modal + '\n</body>');
}

fs.writeFileSync('public/index.html', text, 'utf-8');
console.log('index.html updated successfully');
