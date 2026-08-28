import http from 'http';

// Start a crawl
const startOptions = {
  hostname: 'localhost',
  port: 3004,
  path: '/api/admin/website-sync',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

const startReq = http.request(startOptions, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('START CRAWL RESPONSE:');
    console.log(`Status: ${res.statusCode}`);
    console.log(data);
    
    const response = JSON.parse(data);
    if (response.jobId) {
      console.log(`\nCrawl started with job ID: ${response.jobId}`);
      console.log('Wait 8 seconds for crawl to progress, then kill backend to test interruption...');
    }
  });
});

startReq.on('error', (error) => {
  console.error('Error:', error);
});

startReq.write('{"startUrl":"https://necn.ac.in","maxPages":0}'); // Unlimited pages
startReq.end();
