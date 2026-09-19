const http = require('http');

const req = http.request({
    hostname: 'localhost',
    port: 8080,
    path: '/api/files?url=%2Fdownloads%2Ftrim%2Ftest.mp4',
    method: 'DELETE'
}, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log(`STATUS: ${res.statusCode}`);
        console.log(`BODY: ${data}`);
    });
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
});

req.end();
