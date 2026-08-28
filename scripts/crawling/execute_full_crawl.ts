import { crawlWebsite, recoverStaleCrawlJobs, syncJobMetricsFromUrls } from './src/services/websiteCrawler.js';
import { getDb, rebuildWebsiteKnowledgeFts } from './src/database/db.js';
import { drainAllPendingWebsiteChunks } from './src/services/semanticRag.js';

const db = getDb();

async function runFullIngestion() {
  console.log("==================================================");
  console.log("INITIAL FULL NECN WEBSITE CRAWL & INGESTION");
  console.log("==================================================");

  // Recover or interrupt any active running jobs
  recoverStaleCrawlJobs();

  // Check if a job is already running
  const activeJob = db.prepare("SELECT id FROM crawl_jobs WHERE status='running' LIMIT 1").get() as any;
  if (activeJob) {
    console.log(`[FULL CRAWL] A job (${activeJob.id}) is currently running. Waiting for it to complete...`);
  }

  console.log("Launching crawlWebsite({ startUrl: 'https://necn.ac.in/', maxPages: 0, type: 'FULL' })...");
  const startTime = Date.now();
  const crawlPromise = crawlWebsite({
    startUrl: 'https://necn.ac.in/',
    maxPages: 0,
    type: 'FULL'
  });

  // Give 200ms to insert job record
  await new Promise(r => setTimeout(r, 200));

  const currentJob = db.prepare("SELECT id FROM crawl_jobs WHERE status='running' ORDER BY started_at DESC LIMIT 1").get() as any;
  const jobId = currentJob?.id;
  console.log(`\nFULL CRAWL JOB ID: ${jobId}`);

  let pollCount = 0;
  const pollInterval = setInterval(() => {
    pollCount++;
    if (!jobId) return;
    const row = db.prepare("SELECT status, current_url FROM crawl_jobs WHERE id = ?").get(jobId) as any;
    const counts = db.prepare(`
      SELECT
        COUNT(*) as total_discovered,
        COUNT(CASE WHEN state = 'CRAWLED' THEN 1 END) as total_crawled,
        COUNT(CASE WHEN state = 'FAILED' THEN 1 END) as total_failed,
        COUNT(CASE WHEN state = 'SKIPPED' THEN 1 END) as total_skipped,
        COUNT(CASE WHEN state = 'CRAWLING' THEN 1 END) as total_crawling,
        COUNT(CASE WHEN state = 'QUEUED' THEN 1 END) as total_queued
      FROM crawl_job_urls WHERE job_id = ?
    `).get(jobId) as any;

    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    console.log(`[POLL #${pollCount} | ${elapsedSec}s] Status: ${row?.status || 'N/A'} | Discovered: ${counts.total_discovered} | Crawled: ${counts.total_crawled} | Failed: ${counts.total_failed} | Skipped: ${counts.total_skipped} | Crawling: ${counts.total_crawling} | Queued: ${counts.total_queued}`);
    if (row?.current_url) {
      console.log(`   Current URL: ${row.current_url}`);
    }
  }, 10000);

  const result = await crawlPromise;
  clearInterval(pollInterval);

  console.log("\n==================================================");
  console.log("CRAWL TERMINAL STATE REACHED!");
  console.log("==================================================");

  const finalJob = db.prepare("SELECT * FROM crawl_jobs WHERE id = ?").get(result.jobId) as any;
  const finalUrls = db.prepare(`
    SELECT
      COUNT(*) as total_discovered,
      COUNT(CASE WHEN state = 'CRAWLED' THEN 1 END) as total_crawled,
      COUNT(CASE WHEN state = 'FAILED' THEN 1 END) as total_failed,
      COUNT(CASE WHEN state = 'SKIPPED' THEN 1 END) as total_skipped,
      COUNT(CASE WHEN state = 'CRAWLING' THEN 1 END) as total_crawling,
      COUNT(CASE WHEN state = 'QUEUED' THEN 1 END) as total_queued
    FROM crawl_job_urls WHERE job_id = ?
  `).get(result.jobId) as any;

  console.log(`Final Job ID       : ${finalJob.id}`);
  console.log(`Final Job Status   : ${finalJob.status}`);
  console.log(`Total Discovered   : ${finalUrls.total_discovered}`);
  console.log(`Total Crawled      : ${finalUrls.total_crawled}`);
  console.log(`Total Failed       : ${finalUrls.total_failed}`);
  console.log(`Total Skipped      : ${finalUrls.total_skipped}`);
  console.log(`Total Crawling     : ${finalUrls.total_crawling}`);
  console.log(`Total Queued       : ${finalUrls.total_queued}`);

  console.log("\n==================================================");
  console.log("POST-CRAWL PROCESSING: DRAIN EMBEDDING BACKLOG & REBUILD FTS5");
  console.log("==================================================");

  const drainRes = await drainAllPendingWebsiteChunks();
  console.log(`Embedding Backlog Drain: Processed=${drainRes.totalProcessed}, Failed=${drainRes.totalFailed}`);

  const ftsRes = rebuildWebsiteKnowledgeFts(db);
  console.log(`FTS5 Rebuild: Rebuilt=${ftsRes.rebuilt}, Chunks Indexed=${ftsRes.count}`);

  const activePages = (db.prepare("SELECT count(*) n FROM website_pages WHERE is_active=1").get() as any).n;
  const totalChunks = (db.prepare("SELECT count(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1").get() as any).n;
  const embeddedChunks = (db.prepare("SELECT count(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1 AND c.embedding_json IS NOT NULL").get() as any).n;
  const pendingChunks = totalChunks - embeddedChunks;

  console.log("\n==================================================");
  console.log("FINAL KNOWLEDGE BASE METRICS");
  console.log("==================================================");
  console.log(`Active Stored Pages (website_pages) : ${activePages}`);
  console.log(`Active Chunks (website_chunks)     : ${totalChunks}`);
  console.log(`Embedded Chunks (MiniLM ONNX)       : ${embeddedChunks}`);
  console.log(`Pending Chunks                      : ${pendingChunks}`);

  if (finalUrls.total_queued === 0 && finalUrls.total_crawling === 0 && pendingChunks === 0) {
    console.log("\n>>> FULL INGESTION & EMBEDDING BACKLOG DRAIN SUCCESSFULLY COMPLETED! <<<");
  } else {
    console.log(`\n>>> INGESTION FINISHED WITH QUEUED=${finalUrls.total_queued}, PENDING_EMBEDDINGS=${pendingChunks} <<<`);
  }
}

runFullIngestion().catch(err => {
  console.error("Full ingestion error:", err);
  process.exit(1);
});
