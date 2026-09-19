const fs = require('fs');
let code = fs.readFileSync('public/clipper.js', 'utf8');

// I need to replace handleDraftSubtitle and renderSubtitleEditor again

const target = `function renderSubtitleEditor(data) {
      subtitleEditorContainer.innerHTML = '';
      if (!data || !data.segments) return;
      
      data.segments.forEach((seg, i) => {`;

const replace = `function renderSubtitleEditor(data) {
      subtitleEditorContainer.innerHTML = '';
      if (!data || !Array.isArray(data)) return;
      
      data.forEach((word, i) => {`;

if (code.includes(target)) {
    code = code.replace(target, replace);
}

const target2 = `currentDraftSubtitleData.segments[idx].text = e.target.value;`;
const replace2 = `currentDraftSubtitleData[idx].text = e.target.value;`;
if (code.includes(target2)) {
    code = code.replace(target2, replace2);
}

fs.writeFileSync('public/clipper.js', code, 'utf8');
console.log('clipper.js fixed for array data');
