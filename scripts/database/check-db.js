import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

console.log('=== DATABASE STATE CHECK ===\n');

// Check crawl jobs
console.log('CRAWL JOBS:');
const jobs = db.prepare("SELECT id, status, start_url, pages_discovered, pages_crawled, pages_updated, pages_failed, current_url, last_heartbeat_at FROM crawl_jobs ORDER BY started_at DESC LIMIT 5").all();
jobs.forEach(job => {
  console.log(`  ID: ${job.id}`);
  console.log(`  Status: ${job.status}`);
  console.log(`  Start URL: ${job.start_url}`);
  console.log(`  Discovered: ${job.pages_discovered}`);
  console.log(`  Crawled: ${job.pages_crawled}`);
  console.log(`  Updated: ${job.pages_updated}`);
  console.log(`  Failed: ${job.pages_failed}`);
  console.log(`  Current URL: ${job.current_url || 'none'}`);
  console.log(`  Last Heartbeat: ${job.last_heartbeat_at || 'none'}`);
  console.log('');
});

// Check if crawl_job_urls table exists
console.log('TABLE CHECK:');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('  Tables in database:');
tables.forEach(t => console.log(`    - ${t.name}`));

// Check crawl_job_urls state counts
console.log('\nCRAWL_JOB_URLS STATE COUNTS:');
const stateCounts = db.prepare("SELECT state, COUNT(*) as count FROM crawl_job_urls GROUP BY state").all();
if (stateCounts.length === 0) {
  console.log('  No crawl_job_urls found');
} else {
  stateCounts.forEach(row => {
    console.log(`  ${row.state}: ${row.count}`);
  });
}

// Check crawl_job_urls for the interrupted job
console.log('\nCRAWL_JOB_URLS FOR INTERRUPTED JOB:');
const interruptedJobId = jobs[0]?.id;
if (interruptedJobId) {
  const jobUrlCounts = db.prepare("SELECT state, COUNT(*) as count FROM crawl_job_urls WHERE job_id=? GROUP BY state").all(interruptedJobId);
  if (jobUrlCounts.length === 0) {
    console.log('  No crawl_job_urls found for interrupted job');
  } else {
    jobUrlCounts.forEach(row => {
      console.log(`  ${row.state}: ${row.count}`);
    });
  }
}

// Check website_pages to see if we have existing data
console.log('\nWEBSITE_PAGES COUNT:');
const pagesCount = db.prepare("SELECT COUNT(*) as count FROM website_pages").get();
console.log(`  Total pages: ${pagesCount.count}`);

// Check if there are any pages that were crawled during the interrupted job timeframe
console.log('\nRECENT WEBSITE_PAGES:');
const recentPages = db.prepare("SELECT url, title, last_crawled FROM website_pages ORDER BY last_crawled DESC LIMIT 5").all();
recentPages.forEach(page => {
  console.log(`  URL: ${page.url}`);
  console.log(`  Title: ${page.title || 'none'}`);
  console.log(`  Last Crawled: ${page.last_crawled}`);
  console.log('');
});

// Check running vs interrupted jobs
console.log('\nJOB STATUS SUMMARY:');
const runningCount = db.prepare("SELECT COUNT(*) as count FROM crawl_jobs WHERE status='running'").get();
const interruptedCount = db.prepare("SELECT COUNT(*) as count FROM crawl_jobs WHERE status='interrupted'").get();
const completedCount = db.prepare("SELECT COUNT(*) as count FROM crawl_jobs WHERE status='completed'").get();
console.log(`  Running: ${runningCount.count}`);
console.log(`  Interrupted: ${interruptedCount.count}`);
console.log(`  Completed: ${completedCount.count}`);

db.close();
