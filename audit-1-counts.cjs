// AUDIT 1: counts + crawl_job_urls state breakdown
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve('./data/database.db');
const db = new Database(dbPath, { readonly: true });

console.log('========== DATABASE CONTENT AUDIT ==========\n');

const tables = ['website_pages', 'website_chunks', 'crawl_job_urls', 'crawl_errors', 'crawl_jobs'];
for (const t of tables) {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get();
  console.log(`${t}: ${row.c}`);
}

const activeRow = db.prepare(`SELECT COUNT(*) AS c FROM website_pages WHERE is_active = 1`).get();
const inactiveRow = db.prepare(`SELECT COUNT(*) AS c FROM website_pages WHERE is_active = 0`).get();
console.log(`\nActive website_pages: ${activeRow.c}`);
console.log(`Inactive website_pages: ${inactiveRow.c}`);

const pdfRow = db.prepare(`SELECT COUNT(*) AS c FROM website_pages WHERE url LIKE '%.pdf' OR (content_type IS NOT NULL AND content_type LIKE '%pdf%')`).get();
console.log(`PDF pages (url/content_type match): ${pdfRow.c}`);

// crawl_job_urls grouped by state
console.log('\n--- crawl_job_urls grouped by state ---');
const stateRows = db.prepare(`SELECT state, COUNT(*) AS c FROM crawl_job_urls GROUP BY state ORDER BY c DESC`).all();
for (const r of stateRows) console.log(`${r.state}: ${r.c}`);

console.log('\n--- crawl_jobs (last 10) ---');
const jobs = db.prepare(`SELECT id, started_at, completed_at, status, job_type, pages_discovered, pages_crawled, pages_failed, pdf_documents, chunks_created, current_url FROM crawl_jobs ORDER BY started_at DESC LIMIT 10`).all();
for (const j of jobs) console.log(JSON.stringify(j));

console.log('\n--- website_knowledge_settings ---');
const settings = db.prepare(`SELECT * FROM website_knowledge_settings`).all();
console.log(JSON.stringify(settings, null, 2));

console.log('\n--- crawl_errors count by stage ---');
const errStages = db.prepare(`SELECT stage, COUNT(*) AS c FROM crawl_errors GROUP BY stage ORDER BY c DESC`).all();
for (const e of errStages) console.log(`${e.stage}: ${e.c}`);

console.log('\n--- crawl_errors sample (last 5) ---');
const errSamples = db.prepare(`SELECT job_id, url, http_status, error_message, stage FROM crawl_errors ORDER BY created_at DESC LIMIT 5`).all();
for (const e of errSamples) console.log(JSON.stringify(e));

db.close();
