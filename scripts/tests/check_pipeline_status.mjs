import { getDb } from '../../src/database/db.js';

const db = getDb();
const jobId = 'df4106b8-e7f4-4cfc-96d2-3c73a660638f';

console.log('=== JOB df4106b8-e7f4-4cfc-96d2-3c73a660638f ===');
const job = db.prepare('SELECT * FROM crawl_jobs WHERE id = ?').get(jobId);
console.log(job);

console.log('\n=== URL STATES SUMMARY ===');
const urlSummary = db.prepare(`
  SELECT state, COUNT(*) as count 
  FROM crawl_job_urls 
  WHERE job_id = ? 
  GROUP BY state
`).all(jobId);
console.log(urlSummary);

console.log('\n=== TOTAL DATABASE STATS ===');
const pages = db.prepare('SELECT COUNT(*) as n FROM website_pages WHERE is_active = 1').get().n;
const chunks = db.prepare('SELECT COUNT(*) as n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1').get().n;
const embeddings = db.prepare('SELECT COUNT(*) as n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1 AND c.embedding_json IS NOT NULL').get().n;
const pdfPages = db.prepare('SELECT COUNT(*) as n FROM website_pdf_pages').get().n;

console.log({ activePages: pages, activeChunks: chunks, embeddedChunks: embeddings, pdfPagesExtracted: pdfPages });

console.log('\n=== QUEUED FACULTY & ACADEMIC URLS SAMPLE ===');
const queuedSample = db.prepare(`
  SELECT url FROM crawl_job_urls 
  WHERE job_id = ? AND state = 'QUEUED' AND (url LIKE '%faculty%' OR url LIKE '%academic%' OR url LIKE '%cse%' OR url LIKE '%ece%' OR url LIKE '%regulation%')
  LIMIT 15
`).all(jobId);
console.log(queuedSample);
