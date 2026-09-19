const fs = require('fs');
let code = fs.readFileSync('routes/clipper.js', 'utf8');

const { v4: uuidv4 } = require('uuid'); // ensure uuid is required if not

// Find the check-deps endpoint or the end of the file to insert our new route
const target = `module.exports = router;`;
const replacement = `/** POST /api/clipper/draft-subtitle */
router.post('/clipper/draft-subtitle', async (req, res) => {
  const { videoId, start, end, duration, whisperModel } = req.body;
  if (!videoId) return res.status(400).json({ ok: false, error: 'videoId is required' });
  
  const jobId = Date.now().toString() + '_' + Math.floor(Math.random()*1000);
  const { generateDraftSubtitle } = require('../services/clipperService');
  
  try {
      const data = await generateDraftSubtitle({
          videoId,
          segment: { start: parseFloat(start) || 0, duration: parseFloat(duration) || 0 },
          whisperModel,
          jobId,
          onLog: (msg) => console.log(\`[Draft \${jobId}] \${msg}\`)
      });
      res.json({ ok: true, data });
  } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;`;

code = code.replace(target, replacement);
fs.writeFileSync('routes/clipper.js', code, 'utf8');
console.log('routes/clipper.js updated!');
