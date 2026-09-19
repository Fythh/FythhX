const fs = require('fs');

// 1. Revert routes/clipper.js
let routesCode = fs.readFileSync('routes/clipper.js', 'utf8');
const draftRouteRegex = /\/\*\* POST \/api\/clipper\/draft-subtitle \*\/.+?module\.exports = router;/s;
routesCode = routesCode.replace(draftRouteRegex, 'module.exports = router;');
fs.writeFileSync('routes/clipper.js', routesCode, 'utf8');

// 2. Revert services/clipperService.js
let serviceCode = fs.readFileSync('services/clipperService.js', 'utf8');
const draftFuncRegex = /async function generateDraftSubtitle\(opts\).+?module\.exports = \{[^\}]+?generateDraftSubtitle\n\};/s;
serviceCode = serviceCode.replace(draftFuncRegex, 'module.exports = {\n  scanHeatmap,\n  getVideoInfo,\n  processClip,\n  checkPythonDeps,\n  cancelJobProcesses\n};');
const subRegex = /if \(doSubtitle && opts\.customSubtitleJson\) \{.+?else if \(doSubtitle\) \{/s;
serviceCode = serviceCode.replace(subRegex, 'if (doSubtitle) {');
fs.writeFileSync('services/clipperService.js', serviceCode, 'utf8');

// 3. Revert public/index.html
let htmlCode = fs.readFileSync('public/index.html', 'utf8');
htmlCode = htmlCode.replace('<option value="large-v2">Large V2 (Slang & Akurat)</option>\n                                      <option value="large-v3">Large V3 (Paling Mutakhir)</option>', '');
htmlCode = htmlCode.replace('<option value="large-v2">Large V2 (Slang & Akurat)</option>\n                                    <option value="large-v3">Large V3 (Paling Mutakhir)</option>', '');
htmlCode = htmlCode.replace(/<button id="clipperDraftBtn".+?1\. Generate Teks\s*Subtitle\s*<\/button>\s*/s, '');
htmlCode = htmlCode.replace('2. Render Video', 'Mulai Generate');
htmlCode = htmlCode.replace(/<!-- Modal Subtitle Editor -->.+?<\/div>\s*<\/div>/s, '');
fs.writeFileSync('public/index.html', htmlCode, 'utf8');

// 4. Revert public/clipper.js
let clipperCode = fs.readFileSync('public/clipper.js', 'utf8');
clipperCode = clipperCode.replace(/const clipperDraftBtn = document\.getElementById\('clipperDraftBtn'\);.+?let currentDraftSegment = null;\n\s*/s, '');
clipperCode = clipperCode.replace(/if\(clipperDraftBtn\) clipperDraftBtn\.addEventListener\('click', handleDraftSubtitle\);\n\s*if\(closeSubtitleModal\).+?\n\s*if\(saveSubtitleBtn\).+?\n/s, '');
clipperCode = clipperCode.replace(/async function handleDraftSubtitle\(\).+?function handleSaveSubtitleAndRender\(\).+?handleStartClip\(null, true\);\n  }/s, '');
clipperCode = clipperCode.replace('async function handleStartClip(e, isFromDraft = false) {', 'async function handleStartClip() {');
clipperCode = clipperCode.replace('customSubtitleJson: isFromDraft && currentDraftSubtitleData ? JSON.stringify(currentDraftSubtitleData) : null,', '');
clipperCode = clipperCode.replace('for (let i = 0; i < (isFromDraft ? 1 : boxes.length); i++) {', 'for (let i = 0; i < boxes.length; i++) {');
fs.writeFileSync('public/clipper.js', clipperCode, 'utf8');

console.log('Reverted all files');
