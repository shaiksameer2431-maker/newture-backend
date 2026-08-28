import http from 'http';

const options = {
  hostname: 'localhost',
  port: 3003,
  path: '/api/admin/website-sync',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('START CRAWL RESPONSE:');
    console.log(`Status: ${res.statusCode}`);
    console.log(data);
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write('{"startUrl":"https://necn.ac.in","maxPages":100}'); // 100 pages for interrupt/resume test
req.end();
