import http from 'http';

const options = {
  hostname: 'localhost',
  port: 3006,
  path: '/api/admin/website-sync/resume',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('RESUME RESPONSE:');
    console.log(`Status: ${res.statusCode}`);
    console.log(data);
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write('{"jobId":"3322f13e-d9df-4768-a204-65b0d29ee213"}');
req.end();
