const { crawlWebsite, recoverStaleCrawlJobs } = require('./dist/services/websiteCrawler.js');
const db = require('better-sqlite3')('data/database.db');

async function testControlledCrawl() {
  console.log("==================================================");
  console.log("STARTING CONTROLLED 20-URL CRAWL TEST");
  console.log("==================================================");

  // Mark any running jobs as interrupted first to start a fresh job
  db.prepare("UPDATE crawl_jobs SET status='interrupted' WHERE status='running'").run();

  const startOptions = {
    startUrl: 'https://necn.ac.in/',
    maxPages: 20,
    type: 'FULL'
  };

  console.log("Launching crawlWebsite(maxPages = 20)...");
  const crawlPromise = crawlWebsite(startOptions);

  // Give crawler 100ms to insert its initial job record
  await new Promise(r => setTimeout(r, 100));

  const activeJob = db.prepare("SELECT * FROM crawl_jobs WHERE status='running' ORDER BY started_at DESC LIMIT 1").get();
  if (!activeJob) {
    console.error("FAILED: Could not locate running crawl job in DB!");
    process.exit(1);
  }

  const testJobId = activeJob.id;
  console.log(`\nTEST JOB CREATED! ID: ${testJobId}`);
  console.log(`Job Type: ${activeJob.job_type} | Initial Status: ${activeJob.status}`);

  // Monitor progress
  let step = 0;
  const pollInterval = setInterval(() => {
    step++;
    const currentJob = db.prepare("SELECT * FROM crawl_jobs WHERE id = ?").get(testJobId);
    if (!currentJob) return;

    const urlStats = db.prepare(`
      SELECT
        COUNT(*) as total_discovered,
        COUNT(CASE WHEN state = 'CRAWLED' THEN 1 END) as total_crawled,
        COUNT(CASE WHEN state = 'FAILED' THEN 1 END) as total_failed,
        COUNT(CASE WHEN state = 'SKIPPED' THEN 1 END) as total_skipped,
        COUNT(CASE WHEN state = 'CRAWLING' THEN 1 END) as total_crawling,
        COUNT(CASE WHEN state = 'QUEUED' THEN 1 END) as total_queued
      FROM crawl_job_urls WHERE job_id = ?
    `).get(testJobId);

    console.log(`[POLL #${step}] Status: ${currentJob.status} | URL: ${currentJob.current_url || 'N/A'}`);
    console.log(`  crawl_jobs row  => Discovered: ${currentJob.pages_discovered}, Crawled: ${currentJob.pages_crawled}, Failed: ${currentJob.pages_failed}, Skipped: ${currentJob.documents_skipped}`);
    console.log(`  crawl_job_urls  => Discovered: ${urlStats.total_discovered} (Crawled: ${urlStats.total_crawled}, Failed: ${urlStats.total_failed}, Skipped: ${urlStats.total_skipped}, Crawling: ${urlStats.total_crawling}, Queued: ${urlStats.total_queued})`);
  }, 1000);

  const result = await crawlPromise;
  clearInterval(pollInterval);

  console.log("\n==================================================");
  console.log("CRAWL COMPLETED! VERIFYING MATHEMATICAL INVARIANTS");
  console.log("==================================================");

  const finalJob = db.prepare("SELECT * FROM crawl_jobs WHERE id = ?").get(testJobId);
  const finalUrls = db.prepare(`
    SELECT
      COUNT(*) as total_discovered,
      COUNT(CASE WHEN state = 'CRAWLED' THEN 1 END) as total_crawled,
      COUNT(CASE WHEN state = 'FAILED' THEN 1 END) as total_failed,
      COUNT(CASE WHEN state = 'SKIPPED' THEN 1 END) as total_skipped,
      COUNT(CASE WHEN state = 'CRAWLING' THEN 1 END) as total_crawling,
      COUNT(CASE WHEN state = 'QUEUED' THEN 1 END) as total_queued
    FROM crawl_job_urls WHERE job_id = ?
  `).get(testJobId);

  console.log(`Final Job Status: ${finalJob.status}`);
  console.log(`Job ID remain unchanged: ${finalJob.id === testJobId}`);

  console.log("\nFinal URL-level Counts:");
  console.log(`  DISCOVERED : ${finalUrls.total_discovered}`);
  console.log(`  CRAWLED    : ${finalUrls.total_crawled}`);
  console.log(`  FAILED     : ${finalUrls.total_failed}`);
  console.log(`  SKIPPED    : ${finalUrls.total_skipped}`);
  console.log(`  CRAWLING   : ${finalUrls.total_crawling}`);
  console.log(`  QUEUED     : ${finalUrls.total_queued}`);

  const sumStates = finalUrls.total_crawled + finalUrls.total_failed + finalUrls.total_skipped + finalUrls.total_crawling + finalUrls.total_queued;
  const isSumValid = sumStates === finalUrls.total_discovered;
  const isCrawledValid = finalUrls.total_crawled <= finalUrls.total_discovered;
  const isFailedValid = finalUrls.total_failed <= finalUrls.total_discovered;
  const isQueuedValid = finalUrls.total_queued <= finalUrls.total_discovered;
  const isCrawlingValid = finalUrls.total_crawling <= finalUrls.total_discovered;
  const isJobRowConsistent = (finalJob.pages_discovered === finalUrls.total_discovered) &&
                             (finalJob.pages_crawled === finalUrls.total_crawled) &&
                             (finalJob.pages_failed === finalUrls.total_failed) &&
                             (finalJob.documents_skipped === finalUrls.total_skipped);

  console.log("\nMathematical Validation Check:");
  console.log(`  1. CRAWLED + FAILED + SKIPPED + QUEUED + CRAWLING = DISCOVERED: ${isSumValid} (${sumStates} === ${finalUrls.total_discovered})`);
  console.log(`  2. CRAWLED <= DISCOVERED: ${isCrawledValid} (${finalUrls.total_crawled} <= ${finalUrls.total_discovered})`);
  console.log(`  3. FAILED <= DISCOVERED: ${isFailedValid} (${finalUrls.total_failed} <= ${finalUrls.total_discovered})`);
  console.log(`  4. QUEUED <= DISCOVERED: ${isQueuedValid} (${finalUrls.total_queued} <= ${finalUrls.total_discovered})`);
  console.log(`  5. CRAWLING <= DISCOVERED: ${isCrawlingValid} (${finalUrls.total_crawling} <= ${finalUrls.total_discovered})`);
  console.log(`  6. crawl_jobs table row matches crawl_job_urls aggregates: ${isJobRowConsistent}`);

  if (isSumValid && isCrawledValid && isFailedValid && isQueuedValid && isCrawlingValid && isJobRowConsistent) {
    console.log("\n>>> ALL MATHEMATICAL INVARIANTS PASSED SUCCESSFULLY! <<<");
  } else {
    console.error("\n>>> MATHEMATICAL INVARIANT VALIDATION FAILED! <<<");
    process.exit(1);
  }
}

testControlledCrawl().catch(err => {
  console.error("Test execution error:", err);
  process.exit(1);
});
