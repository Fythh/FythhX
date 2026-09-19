const { execSync } = require('child_process');

async function testYouTubeDirectUrl() {
  console.log('Running yt-dlp to get direct URL...');
  const ytDlp = 'e:\\Project\\dev-tools-fythhx\\stableversion\\FytX-1.0\\tools\\yt-dlp.exe';
  const url = 'https://youtu.be/ZJLJBl6yMas?si=TQ-NMXsgvQ2oBRgp'; // Using the URL from the logs
  const stdout = execSync(`"${ytDlp}" -g "${url}"`).toString();
  const directUrl = stdout.trim().split('\n')[0];
  console.log('Got Direct URL (length:', directUrl.length, ')');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
  };

  console.log('\n--- TEST 1: HTTP Range Header (0-10MB) ---');
  try {
    const res1 = await fetch(directUrl, { headers: { ...headers, 'Range': 'bytes=0-10485750' } });
    console.log('TEST 1 Status:', res1.status);
    console.log('TEST 1 Headers:');
    for (const [key, value] of res1.headers.entries()) {
      console.log(`  ${key}: ${value}`);
    }
  } catch(e) { console.error('TEST 1 Failed:', e.message); }

  console.log('\n--- TEST 2: HTTP Range Header (0-) [Open ended] ---');
  try {
    const res2 = await fetch(directUrl, { headers: { ...headers, 'Range': 'bytes=0-' } });
    console.log('TEST 2 Status:', res2.status);
  } catch(e) { console.error('TEST 2 Failed:', e.message); }

  console.log('\n--- TEST 3: URL Query Param (&range=0-10485750) ---');
  try {
    const qUrl = `${directUrl}${directUrl.includes('?') ? '&' : '?'}range=0-10485750`;
    const res3 = await fetch(qUrl, { headers });
    console.log('TEST 3 Status:', res3.status);
  } catch(e) { console.error('TEST 3 Failed:', e.message); }

  console.log('\n--- TEST 4: URL Query Param (&range=0-) [Open ended] ---');
  try {
    const qUrl2 = `${directUrl}${directUrl.includes('?') ? '&' : '?'}range=0-`;
    const res4 = await fetch(qUrl2, { headers });
    console.log('TEST 4 Status:', res4.status);
  } catch(e) { console.error('TEST 4 Failed:', e.message); }
}

testYouTubeDirectUrl();
