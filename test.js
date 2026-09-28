const http = require('http');
const server = require('./server.js');

const PORT = process.env.PORT || 8080;

function runTests() {
  console.log('Running automated health and endpoint verification...');
  
  http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (res.statusCode === 200 && json.status === 'ok') {
          console.log('Test PASSED: /health endpoint returned ok.');
          
          http.get(`http://127.0.0.1:${PORT}/api/downloads`, (res2) => {
            let data2 = '';
            res2.on('data', chunk => data2 += chunk);
            res2.on('end', () => {
              try {
                const json2 = JSON.parse(data2);
                if (res2.statusCode === 200 && Array.isArray(json2)) {
                  console.log('Test PASSED: /api/downloads endpoint returned array.');
                  server.close(() => process.exit(0));
                } else {
                  console.error('Test FAILED: /api/downloads invalid response');
                  server.close(() => process.exit(1));
                }
              } catch (e) {
                console.error('Test FAILED: /api/downloads JSON parse error');
                server.close(() => process.exit(1));
              }
            });
          });
        } else {
          console.error('Test FAILED: /health invalid response');
          server.close(() => process.exit(1));
        }
      } catch (e) {
        console.error('Test FAILED: /health JSON parse error');
        server.close(() => process.exit(1));
      }
    });
  }).on('error', (err) => {
    console.error('Test FAILED: could not connect to server', err);
    server.close(() => process.exit(1));
  });
}

setTimeout(runTests, 1000);
