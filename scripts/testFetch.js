const ytDlp = require('../services/ytDlpService');

async function test() {
  try {
    const data = await ytDlp.fetchMetadata('https://www.youtube.com/watch?v=LXb3EKWsInQ', 'none');
    console.log(JSON.stringify(data.formats.video, null, 2));
  } catch(e) {
    console.error(e);
  }
}
test();
