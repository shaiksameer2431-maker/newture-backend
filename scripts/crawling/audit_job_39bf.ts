import { getDb } from './src/database/db.js';
import { syncJobMetricsFromUrls } from './src/services/websiteCrawler.js';

const db = getDb();
const jobId = '39bf4c9b-36bf-4210-83db-77e9a7208209';

// Apply metric & status sync
syncJobMetricsFromUrls(db, jobId, null);

console.log("==================================================");
console.log(`AUTHORITATIVE INSPECTION REPORT FOR JOB: ${jobId}`);
console.log("==================================================");

const job = db.prepare("SELECT * FROM crawl_jobs WHERE id = ?").get(jobId) as any;

if (!job) {
  console.error("Job not found!");
  process.exit(1);
}

console.log("CRAWL_JOBS TABLE ROW METRICS:");
console.log(`  Job ID            : ${job.id}`);
console.log(`  Job Type          : ${job.job_type}`);
console.log(`  Status            : ${job.status}`);
console.log(`  Started At        : ${job.started_at}`);
console.log(`  Completed At      : ${job.completed_at || 'N/A'}`);
console.log(`  Last Heartbeat At : ${job.last_heartbeat_at || 'N/A'}`);
console.log(`  Pages Discovered  : ${job.pages_discovered}`);
console.log(`  Pages Crawled     : ${job.pages_crawled}`);
console.log(`  Pages Failed      : ${job.pages_failed}`);
console.log(`  Pages Updated     : ${job.pages_updated}`);
console.log(`  Pages New         : ${job.pages_new}`);
console.log(`  Pages Unchanged   : ${job.pages_unchanged}`);
console.log(`  PDF Documents     : ${job.pdf_documents}`);
console.log(`  Docs Skipped      : ${job.documents_skipped}`);
console.log(`  Docs Too Large    : ${job.documents_too_large}`);
console.log(`  Chunks Created    : ${job.chunks_created}`);
console.log(`  Current URL       : ${job.current_url || 'None'}`);
console.log(`  Error / Diagnostic: ${job.error || 'None'}`);

console.log("\nAUTHORITATIVE RECALCULATION FROM crawl_job_urls TABLE:");
const totalRows = db.prepare("SELECT COUNT(*) as cnt FROM crawl_job_urls WHERE job_id = ?").get(jobId).cnt;
const uniqueUrls = db.prepare("SELECT COUNT(DISTINCT url) as cnt FROM crawl_job_urls WHERE job_id = ?").get(jobId).cnt;
const queuedUrls = db.prepare("SELECT COUNT(DISTINCT url) as cnt FROM crawl_job_urls WHERE job_id = ? AND state='QUEUED'").get(jobId).cnt;
const crawlingUrls = db.prepare("SELECT COUNT(DISTINCT url) as cnt FROM crawl_job_urls WHERE job_id = ? AND state='CRAWLING'").get(jobId).cnt;
const crawledUrls = db.prepare("SELECT COUNT(DISTINCT url) as cnt FROM crawl_job_urls WHERE job_id = ? AND state='CRAWLED'").get(jobId).cnt;
const failedUrls = db.prepare("SELECT COUNT(DISTINCT url) as cnt FROM crawl_job_urls WHERE job_id = ? AND state='FAILED'").get(jobId).cnt;
const skippedUrls = db.prepare("SELECT COUNT(DISTINCT url) as cnt FROM crawl_job_urls WHERE job_id = ? AND state='SKIPPED'").get(jobId).cnt;

console.log(`  Total Rows in crawl_job_urls         : ${totalRows}`);
console.log(`  Total Unique Discovered URLs         : ${uniqueUrls}`);
console.log(`  Queued URLs                          : ${queuedUrls}`);
console.log(`  Crawling URLs                        : ${crawlingUrls}`);
console.log(`  Crawled URLs                         : ${crawledUrls}`);
console.log(`  Failed URLs                          : ${failedUrls}`);
console.log(`  Skipped URLs                         : ${skippedUrls}`);

console.log("\nTERMINAL-STATE RULE VERIFICATION FOR JOB 39bf4c9b:");
console.log(`  Status in crawl_jobs table : ${job.status}`);
console.log(`  QUEUED (${queuedUrls}) > 0 || CRAWLING (${crawlingUrls}) > 0 => MUST NOT BE 'completed': ${job.status !== 'completed'}`);
console.log(`  Job Status is correctly 'interrupted' / non-completed: ${job.status === 'interrupted'}`);
