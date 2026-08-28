import { getDb, rebuildWebsiteKnowledgeFts } from '../../src/database/db.js';

const db = getDb();
const jobId = 'df4106b8-e7f4-4cfc-96d2-3c73a660638f';

console.log('=== FIXING DATABASE INTEGRITY ITEMS ===\n');

// Item 1: Find successful URL with no document record
const missingDocUrls = db.prepare(`
  SELECT u.url FROM crawl_job_urls u
  LEFT JOIN website_pages p ON p.url = u.url
  WHERE u.job_id = ? AND u.state = 'CRAWLED' AND u.http_status = 200 AND p.id IS NULL
`).all(jobId);

console.log('Missing document URLs:', missingDocUrls);

for (const row of missingDocUrls) {
  // Mark state as QUEUED so crawler picks it up or re-inserts if valid
  db.prepare("UPDATE crawl_job_urls SET state = 'QUEUED' WHERE job_id = ? AND url = ?").run(jobId, row.url);
  console.log(`Re-queued missing URL: ${row.url}`);
}

// Item 2: Rebuild FTS5 index to fix missing 55 FTS5 records
console.log('Rebuilding FTS5 index table...');
rebuildWebsiteKnowledgeFts(db);
console.log('FTS5 index rebuild complete!');

// Re-verify
const ftsCount = db.prepare("SELECT COUNT(*) n FROM chunks_fts").get().n;
const chunkCount = db.prepare("SELECT COUNT(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1").get().n;
const missingFts5 = db.prepare(`
  SELECT COUNT(*) n FROM website_chunks c
  LEFT JOIN chunks_fts fts ON fts.rowid = c.rowid
  WHERE fts.rowid IS NULL
`).get().n;

console.log(`Updated Chunks: ${chunkCount}, FTS5 Records: ${ftsCount}, Missing FTS5: ${missingFts5}`);
