const { execSync } = require('child_process');

async function test() {
  const url = 'https://www.youtube.com/watch?v=CwCPuVHYEYc';
  console.log('Getting url...');
  const ytDlpCmd = `.\\tools\\yt-dlp.exe -f "400" -g "${url}" --no-warnings`;
  const streamUrl = execSync(ytDlpCmd).toString().trim().split('\n')[0];
  
  console.log('Got URL. Fetching range...');
  const fs = require('fs');
  const path = require('path');
  const cookiePath = path.join(__dirname, '..', 'cookies.txt');
  let cookieStr = '';
  if (fs.existsSync(cookiePath)) {
    const lines = fs.readFileSync(cookiePath, 'utf8').split('\n');
    const cookies = [];
    lines.forEach(line => {
      if (line.startsWith('#') || line.trim() === '') return;
      const parts = line.split('\t');
      if (parts.length >= 7) {
        cookies.push(`${parts[5]}=${parts[6].trim()}`);
      }
    });
    cookieStr = cookies.join('; ');
  }
  
  const headers = {
    'Range': 'bytes=0-5242879',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
  };
  if (cookieStr) headers['Cookie'] = cookieStr;
  
  try {
    const res = await fetch(streamUrl, { headers });
    console.log(`Status: ${res.status}`);
    const buf = await res.arrayBuffer();
    console.log(`Received: ${buf.byteLength} bytes`);
  } catch (e) {
    console.error(e);
  }
}
test();
