import { crawlWebsite, syncJobMetricsFromUrls } from './src/services/websiteCrawler.js';
import { getDb } from './src/database/db.js';

const db = getDb();

async function runTests() {
  console.log("==================================================");
  console.log("TEST 1: CONTROLLED FULLY FINISHED CRAWL (QUEUED=0)");
  console.log("==================================================");

  // Mark running jobs interrupted
  db.prepare("UPDATE crawl_jobs SET status='interrupted' WHERE status='running'").run();

  // Pick 20 specific URLs for retry/isolated crawl test where queue drains completely
  const sampleUrls = [
    'https://necn.ac.in/',
    'https://necn.ac.in/site-map.php',
    'https://necn.ac.in/institute-history.php',
    'https://necn.ac.in/mission-vision.php',
    'https://necn.ac.in/founder-desk.php',
    'https://necn.ac.in/accreditation.php',
    'https://necn.ac.in/recognition.php',
    'https://necn.ac.in/annual-reports.php',
    'https://necn.ac.in/organisation-chart.php',
    'https://necn.ac.in/route-map.php',
    'https://necn.ac.in/prinicpal-desk.php',
    'https://necn.ac.in/director-desk.php',
    'https://necn.ac.in/sponsoring-body.php',
    'https://necn.ac.in/administration.php',
    'https://necn.ac.in/governing-body.php',
    'https://necn.ac.in/internal-complaint-committe.php',
    'https://necn.ac.in/academic-leadership.php',
    'https://necn.ac.in/executive-council.php',
    'https://necn.ac.in/details-of-academic-programs.php',
    'https://necn.ac.in/academic-calender.php'
  ];

  const finishedTest = await crawlWebsite({
    startUrl: 'https://necn.ac.in/',
    maxPages: 20,
    type: 'RETRY_FAILED',
    retryOnlyUrls: sampleUrls
  });

  const job1 = db.prepare("SELECT * FROM crawl_jobs WHERE id = ?").get(finishedTest.jobId) as any;
  const urls1 = db.prepare(`
    SELECT
      COUNT(*) as total_discovered,
      COUNT(CASE WHEN state = 'CRAWLED' THEN 1 END) as total_crawled,
      COUNT(CASE WHEN state = 'FAILED' THEN 1 END) as total_failed,
      COUNT(CASE WHEN state = 'SKIPPED' THEN 1 END) as total_skipped,
      COUNT(CASE WHEN state = 'CRAWLING' THEN 1 END) as total_crawling,
      COUNT(CASE WHEN state = 'QUEUED' THEN 1 END) as total_queued
    FROM crawl_job_urls WHERE job_id = ?
  `).get(finishedTest.jobId) as any;

  console.log(`Test 1 Job ID         : ${finishedTest.jobId}`);
  console.log(`Test 1 Status         : ${job1.status}`);
  console.log(`Test 1 Discovered     : ${urls1.total_discovered}`);
  console.log(`Test 1 Queued         : ${urls1.total_queued}`);
  console.log(`Test 1 Crawling       : ${urls1.total_crawling}`);
  console.log(`Test 1 Crawled        : ${urls1.total_crawled}`);
  console.log(`Test 1 Failed         : ${urls1.total_failed}`);

  const test1Valid = urls1.total_discovered === 20 &&
                     urls1.total_queued === 0 &&
                     urls1.total_crawling === 0 &&
                     job1.status === 'completed';

  console.log(`Test 1 PASS (Discovered=20, Queued=0, Crawling=0, Status='completed'): ${test1Valid}`);

  console.log("\n==================================================");
  console.log("TEST 2: UNFINISHED CRAWL JOB TERMINAL-STATE CHECK (QUEUED>0)");
  console.log("==================================================");

  db.prepare("UPDATE crawl_jobs SET status='interrupted' WHERE status='running'").run();

  // Run a FULL crawl capped at maxPages=5 while discovering sitemap graph (~135 URLs)
  const unfinishedTest = await crawlWebsite({
    startUrl: 'https://necn.ac.in/',
    maxPages: 5,
    type: 'FULL'
  });

  const job2 = db.prepare("SELECT * FROM crawl_jobs WHERE id = ?").get(unfinishedTest.jobId) as any;
  const urls2 = db.prepare(`
    SELECT
      COUNT(*) as total_discovered,
      COUNT(CASE WHEN state = 'CRAWLED' THEN 1 END) as total_crawled,
      COUNT(CASE WHEN state = 'FAILED' THEN 1 END) as total_failed,
      COUNT(CASE WHEN state = 'SKIPPED' THEN 1 END) as total_skipped,
      COUNT(CASE WHEN state = 'CRAWLING' THEN 1 END) as total_crawling,
      COUNT(CASE WHEN state = 'QUEUED' THEN 1 END) as total_queued
    FROM crawl_job_urls WHERE job_id = ?
  `).get(unfinishedTest.jobId) as any;

  console.log(`Test 2 Job ID         : ${unfinishedTest.jobId}`);
  console.log(`Test 2 Status         : ${job2.status}`);
  console.log(`Test 2 Discovered     : ${urls2.total_discovered}`);
  console.log(`Test 2 Queued         : ${urls2.total_queued}`);
  console.log(`Test 2 Crawling       : ${urls2.total_crawling}`);
  console.log(`Test 2 Crawled        : ${urls2.total_crawled}`);
  console.log(`Test 2 Failed         : ${urls2.total_failed}`);

  const test2Valid = urls2.total_queued > 0 &&
                     job2.status === 'interrupted' &&
                     job2.status !== 'completed';

  console.log(`Test 2 PASS (Queued > 0 => Status is 'interrupted' and NOT 'completed'): ${test2Valid}`);

  console.log("\n==================================================");
  console.log("TEST 3: VERIFY JOB 39bf4c9b STATUS IN DATABASE");
  console.log("==================================================");

  const job39 = '39bf4c9b-36bf-4210-83db-77e9a7208209';
  syncJobMetricsFromUrls(db, job39, null);
  const row39 = db.prepare("SELECT * FROM crawl_jobs WHERE id = ?").get(job39) as any;
  const urls39 = db.prepare(`
    SELECT
      COUNT(*) as total_discovered,
      COUNT(CASE WHEN state = 'QUEUED' THEN 1 END) as total_queued,
      COUNT(CASE WHEN state = 'CRAWLING' THEN 1 END) as total_crawling
    FROM crawl_job_urls WHERE job_id = ?
  `).get(job39) as any;

  console.log(`Job 39bf4c9b Status     : ${row39.status}`);
  console.log(`Job 39bf4c9b Queued     : ${urls39.total_queued}`);
  console.log(`Job 39bf4c9b Crawling   : ${urls39.total_crawling}`);

  const test3Valid = (urls39.total_queued > 0 || urls39.total_crawling > 0) && row39.status !== 'completed' && row39.status === 'interrupted';
  console.log(`Test 3 PASS (Job 39bf4c9b corrected to 'interrupted'): ${test3Valid}`);

  console.log("\n==================================================");
  console.log("FINAL SUMMARY VERIFICATION");
  console.log("==================================================");

  if (test1Valid && test2Valid && test3Valid) {
    console.log(">>> ALL TERMINAL-STATE TESTS PASSED SUCCESSFULLY! <<<");
  } else {
    console.error(">>> TEST FAILED! <<<");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
