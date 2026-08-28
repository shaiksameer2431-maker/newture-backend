import http from 'http';

const options = {
  hostname: 'localhost',
  port: 3003,
  path: '/api/website-sync/diagnostics',
  method: 'GET'
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('DIAGNOSTICS RESPONSE:');
    console.log(data);
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.end();
