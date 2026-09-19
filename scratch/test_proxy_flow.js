const path = require('path');
async function testEndpoint() {
  console.log('Testing FFmpeg with -skip_frame nokey...');
  
  const ffmpegExe = path.join(__dirname, '..', 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe');
  
  const ytUrl = 'https://youtu.be/ZJLJBl6yMas?si=TQ-NMXsgvQ2oBRgp'; // 26 min
  const ytdlpArgs = ['-f', 'worstvideo[ext=mp4]/worstvideo/worst', '-g', '--no-warnings', '--force-ipv4', ytUrl];
  const url = await new Promise((res, rej) => require('child_process').execFile(path.join(__dirname, '..', 'tools', 'yt-dlp.exe'), ytdlpArgs, {maxBuffer: 1024*1024}, (e,out) => e ? rej(e) : res(out.trim().split('\n')[0])));
  
  console.log('Got URL:', url.substring(0, 50) + '...');
  
  const start = Date.now();
  const args = [
    '-skip_frame', 'nokey', // MAGIC FLAG!
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    '-i', url,
    '-vf', 'fps=60/1590,scale=160:90,tile=8x8',
    '-frames:v', '1',
    '-y', 'test_sprite.jpg'
  ];
  
  const ff = require('child_process').spawn(ffmpegExe, args);
  ff.stderr.on('data', d => process.stdout.write(d.toString()));
  ff.on('close', code => {
    console.log(`FFmpeg exited with ${code} in ${(Date.now()-start)/1000}s`);
  });
}
testEndpoint();
