const db = require('better-sqlite3')('data/database.db');

console.log("==========================================");
console.log("DETAILED CRAWL JOB & URL AUDIT REPORT");
console.log("==========================================");

const jobs = db.prepare("SELECT * FROM crawl_jobs ORDER BY started_at DESC").all();
console.log(`\nFound ${jobs.length} jobs in crawl_jobs table:\n`);

for (const job of jobs) {
  console.log(`--------------------------------------------------`);
  console.log(`JOB ID: ${job.id}`);
  console.log(`  Type: ${job.job_type} | Status: ${job.status}`);
  console.log(`  Started: ${job.started_at} | Completed: ${job.completed_at || 'N/A'}`);
  console.log(`  Last Heartbeat: ${job.last_heartbeat_at || 'N/A'}`);
  console.log(`  Stored in crawl_jobs row:`);
  console.log(`    Discovered: ${job.pages_discovered} | Crawled: ${job.pages_crawled} | Failed: ${job.pages_failed} | Updated: ${job.pages_updated}`);
  console.log(`    New: ${job.pages_new} | Unchanged: ${job.pages_unchanged} | PDFs: ${job.pdf_documents}`);

  // Recalculate from crawl_job_urls
  const totalRows = db.prepare("SELECT COUNT(*) as cnt FROM crawl_job_urls WHERE job_id = ?").get(job.id).cnt;
  const uniqueUrls = db.prepare("SELECT COUNT(DISTINCT url) as cnt FROM crawl_job_urls WHERE job_id = ?").get(job.id).cnt;
  const states = db.prepare("SELECT state, COUNT(*) as cnt, COUNT(DISTINCT url) as dist_cnt FROM crawl_job_urls WHERE job_id = ? GROUP BY state").all(job.id);
  const dupes = db.prepare("SELECT COUNT(*) as dup_urls FROM (SELECT url FROM crawl_job_urls WHERE job_id = ? GROUP BY url HAVING COUNT(*) > 1)").get(job.id).dup_urls;
  const retries = db.prepare("SELECT SUM(attempts) as total_attempts, COUNT(CASE WHEN attempts > 1 THEN 1 END) as retried_urls FROM crawl_job_urls WHERE job_id = ?").get(job.id);

  console.log(`  Actual from crawl_job_urls:`);
  console.log(`    Total Rows in table: ${totalRows}`);
  console.log(`    Unique Discovered URLs: ${uniqueUrls}`);
  console.log(`    Duplicate URL rows: ${dupes}`);
  console.log(`    Total Attempts: ${retries.total_attempts || 0} | Retried URLs (>1 attempt): ${retries.retried_urls || 0}`);
  console.log(`    Breakdown by state:`);
  for (const s of states) {
    console.log(`      - ${s.state}: ${s.cnt} rows (${s.dist_cnt} unique URLs)`);
  }
}

console.log("\n==========================================");
console.log("GLOBAL DATABASE SUMMARY (All jobs combined)");
console.log("==========================================");

const globalTotalRows = db.prepare("SELECT COUNT(*) as cnt FROM crawl_job_urls").get().cnt;
const globalUniqueUrls = db.prepare("SELECT COUNT(DISTINCT url) as cnt FROM crawl_job_urls").get().cnt;
const globalStates = db.prepare("SELECT state, COUNT(*) as cnt, COUNT(DISTINCT url) as dist_cnt FROM crawl_job_urls GROUP BY state").all();

console.log(`Global total rows in crawl_job_urls: ${globalTotalRows}`);
console.log(`Global unique URLs across all jobs: ${globalUniqueUrls}`);
console.log(`Global state breakdown:`);
for (const s of globalStates) {
  console.log(`  - ${s.state}: ${s.cnt} rows (${s.dist_cnt} unique URLs)`);
}

const pageCount = db.prepare("SELECT COUNT(*) as cnt FROM website_pages WHERE is_active=1").get().cnt;
const chunkCount = db.prepare("SELECT COUNT(*) as cnt FROM website_chunks").get().cnt;
console.log(`\nActive pages in website_pages: ${pageCount}`);
console.log(`Total chunks in website_chunks: ${chunkCount}`);

console.log("\n==========================================");
console.log("CHECKING SUMS ACROSS MULTIPLE JOBS");
console.log("==========================================");
const sumJobs = db.prepare("SELECT SUM(pages_discovered) as total_disc, SUM(pages_crawled) as total_crawled, SUM(pages_failed) as total_failed FROM crawl_jobs").get();
console.log(`Sum of pages_discovered across all jobs: ${sumJobs.total_disc}`);
console.log(`Sum of pages_crawled across all jobs: ${sumJobs.total_crawled}`);
console.log(`Sum of pages_failed across all jobs: ${sumJobs.total_failed}`);
