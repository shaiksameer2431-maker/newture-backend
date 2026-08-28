/**
 * Full local NECN knowledge ingestion script.
 */
import fs from 'node:fs';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

import { crawlWebsite } from '../../src/services/websiteCrawler.js';
import { getDb, getDbPath, rebuildWebsiteKnowledgeFts } from '../../src/database/db.js';
import { drainAllPendingWebsiteChunks } from '../../src/services/semanticRag.js';

function n(value: unknown): number { return Number(value || 0); }
function line(label: string, value: unknown) { console.log(`${label.padEnd(30)} ${value}`); }

async function main() {
  const db = getDb();
  const jobId = 'df4106b8-e7f4-4cfc-96d2-3c73a660638f';

  // Calculate actual startup stats directly from database
  const discovered = n(db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ?").get(jobId)?.n);
  const processed = n(db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state IN ('CRAWLED', 'FAILED', 'SKIPPED')").get(jobId)?.n);
  const remaining = n(db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state IN ('QUEUED', 'CRAWLING')").get(jobId)?.n);
  const successful = n(db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state = 'CRAWLED' AND http_status = 200").get(jobId)?.n);
  const failed = n(db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state = 'FAILED'").get(jobId)?.n);
  const skipped = n(db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state = 'SKIPPED'").get(jobId)?.n);

  console.log('========================================');
  console.log('NECN INGESTION RESUME');
  console.log('========================================');
  line('Discovered:', discovered);
  line('Already processed:', processed);
  line('Remaining:', remaining);
  line('Successful:', successful);
  line('Failed:', failed);
  line('Skipped:', skipped);
  console.log('========================================\n');

  const maxPages = Number(process.env.NECN_MAX_PAGES || 0);
  const result = await crawlWebsite({
    startUrl: 'https://www.necn.ac.in/',
    maxPages: Number.isFinite(maxPages) ? maxPages : 0,
    type: 'FULL'
  });

  const embeddings = await drainAllPendingWebsiteChunks();
  const fts = rebuildWebsiteKnowledgeFts(db);

  // Final Audit Counts
  const totDiscovered = n(db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ?").get(jobId)?.n);
  const totCrawled = n(db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state IN ('CRAWLED', 'COMPLETED')").get(jobId)?.n);
  const totSuccessful = n(db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state = 'CRAWLED' AND http_status = 200").get(jobId)?.n);
  const totFailed = n(db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state = 'FAILED'").get(jobId)?.n);
  const totSkipped = n(db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state = 'SKIPPED'").get(jobId)?.n);
  const totPending = n(db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state IN ('QUEUED', 'CRAWLING')").get(jobId)?.n);

  const docs = n(db.prepare("SELECT COUNT(*) n FROM website_pages WHERE is_active = 1").get()?.n);
  const htmlDocs = n(db.prepare("SELECT COUNT(*) n FROM website_pages WHERE is_active = 1 AND (content_type LIKE '%html%' OR content_type IS NULL OR content_type = '')").get()?.n);
  const pdfDocs = n(db.prepare("SELECT COUNT(*) n FROM website_pages WHERE is_active = 1 AND content_type = 'application/pdf'").get()?.n);
  const pdfPages = n(db.prepare("SELECT COUNT(*) n FROM website_pdf_pages").get()?.n);

  const chunks = n(db.prepare("SELECT COUNT(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1").get()?.n);
  const fts5 = n(db.prepare("SELECT COUNT(*) n FROM chunks_fts").get()?.n);
  const embedded = n(db.prepare("SELECT COUNT(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1 AND c.embedding_json IS NOT NULL").get()?.n);

  console.log('\n========================================');
  console.log('NECN INGESTION FINAL REPORT');
  console.log('========================================');
  line('Discovered URLs:', totDiscovered);
  line('Successfully processed:', totSuccessful);
  line('Failed:', totFailed);
  line('Skipped:', totSkipped);
  line('Pending URLs:', totPending);
  console.log('');
  line('HTML documents:', htmlDocs);
  line('PDF documents:', pdfDocs);
  line('Other documents:', Math.max(0, docs - htmlDocs - pdfDocs));
  line('PDF pages:', pdfPages);
  console.log('');
  line('Documents:', docs);
  line('Chunks:', chunks);
  line('FTS5 records:', fts5);
  line('Embeddings:', embedded);
  console.log('========================================\n');
}

main().catch(error => { console.error('[INGEST NECN] Fatal:', error); process.exitCode = 1; });
