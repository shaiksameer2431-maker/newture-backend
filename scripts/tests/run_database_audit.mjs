import { getDb } from '../../src/database/db.js';

const db = getDb();
const jobId = 'df4106b8-e7f4-4cfc-96d2-3c73a660638f';

console.log('==========================================================================');
console.log('NECN DATABASE VERIFICATION & PERSISTENCE AUDIT');
console.log('==========================================================================\n');

// 1. URL State Counts from crawl_job_urls
const totalDiscovered = db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ?").get(jobId).n;
const totalCrawled = db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state IN ('CRAWLED', 'COMPLETED')").get(jobId).n;
const totalSuccessful = db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state = 'CRAWLED' AND http_status = 200").get(jobId).n;
const totalFailed = db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state = 'FAILED'").get(jobId).n;
const totalSkipped = db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state = 'SKIPPED'").get(jobId).n;
const totalPending = db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state IN ('QUEUED', 'CRAWLING')").get(jobId).n;

// 2. Stored Document Counts from website_pages
const storedDocs = db.prepare("SELECT COUNT(*) n FROM website_pages WHERE is_active = 1").get().n;
const storedHtmlDocs = db.prepare("SELECT COUNT(*) n FROM website_pages WHERE is_active = 1 AND (content_type LIKE '%html%' OR content_type IS NULL OR content_type = '')").get().n;
const storedPdfDocs = db.prepare("SELECT COUNT(*) n FROM website_pages WHERE is_active = 1 AND content_type = 'application/pdf'").get().n;
const storedOtherDocs = storedDocs - (storedHtmlDocs + storedPdfDocs);

// 3. PDF Pages, Chunks, FTS5, Embeddings
const storedPdfPages = db.prepare("SELECT COUNT(*) n FROM website_pdf_pages").get().n;
const storedChunks = db.prepare("SELECT COUNT(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1").get().n;
const fts5Records = db.prepare("SELECT COUNT(*) n FROM chunks_fts").get().n;
const storedEmbeddings = db.prepare("SELECT COUNT(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1 AND c.embedding_json IS NOT NULL").get().n;

// 4. Content Integrity Audits
// Category 1: Successful URL with no document
const successfulUrlNoDoc = db.prepare(`
  SELECT COUNT(*) n FROM crawl_job_urls u
  LEFT JOIN website_pages p ON p.url = u.url
  WHERE u.job_id = ? AND u.state = 'CRAWLED' AND u.http_status = 200 AND p.id IS NULL
`).get(jobId).n;

// Category 2: Document with empty content
const docWithEmptyContent = db.prepare(`
  SELECT COUNT(*) n FROM website_pages
  WHERE is_active = 1 AND (content IS NULL OR trim(content) = '' OR length(content) < 10)
`).get().n;

// Category 3: Document with no chunks
const docWithNoChunks = db.prepare(`
  SELECT COUNT(*) n FROM website_pages p
  LEFT JOIN website_chunks c ON c.page_id = p.id
  WHERE p.is_active = 1 AND c.id IS NULL
`).get().n;

// Category 4: PDF with missing pages
const pdfWithMissingPages = db.prepare(`
  SELECT COUNT(*) n FROM website_pages p
  LEFT JOIN website_pdf_pages pdf ON pdf.page_id = p.id
  WHERE p.is_active = 1 AND p.content_type = 'application/pdf' AND pdf.id IS NULL
`).get().n;

// Category 5: Chunk missing source URL
const chunkMissingSourceUrl = db.prepare(`
  SELECT COUNT(*) n FROM website_chunks c
  LEFT JOIN website_pages p ON p.id = c.page_id
  WHERE p.url IS NULL OR trim(p.url) = ''
`).get().n;

// Category 6: Missing FTS5 records
const missingFts5Records = db.prepare(`
  SELECT COUNT(*) n FROM website_chunks c
  LEFT JOIN chunks_fts fts ON fts.chunk_id = c.id
  WHERE fts.chunk_id IS NULL
`).get().n;

// Category 7: Missing embeddings
const missingEmbeddings = db.prepare(`
  SELECT COUNT(*) n FROM website_chunks c
  JOIN website_pages p ON p.id = c.page_id
  WHERE p.is_active = 1 AND (c.embedding_json IS NULL OR c.embedding_dim IS NULL)
`).get().n;

console.log('NECN DATABASE AUDIT');
console.log('===================');
console.log(`Discovered URLs:          ${totalDiscovered}`);
console.log(`Crawled URLs:             ${totalCrawled}`);
console.log(`Successful crawls:        ${totalSuccessful}`);
console.log(`Failed:                   ${totalFailed}`);
console.log(`Skipped:                  ${totalSkipped}`);
console.log(`Pending:                  ${totalPending}`);
console.log('');
console.log(`Documents:                ${storedDocs}`);
console.log(`HTML documents:           ${storedHtmlDocs}`);
console.log(`PDF documents:            ${storedPdfDocs}`);
console.log(`Other documents:          ${storedOtherDocs}`);
console.log(`PDF pages:                ${storedPdfPages}`);
console.log('');
console.log(`Chunks:                   ${storedChunks}`);
console.log(`FTS5 records:             ${fts5Records}`);
console.log(`Embeddings:               ${storedEmbeddings}`);
console.log('');
console.log(`Successful URL with no document: ${successfulUrlNoDoc}`);
console.log(`Document with empty content:       ${docWithEmptyContent}`);
console.log(`Document with no chunks:            ${docWithNoChunks}`);
console.log(`PDF with missing pages:             ${pdfWithMissingPages}`);
console.log(`Chunk missing source URL:            ${chunkMissingSourceUrl}`);
console.log(`Missing FTS5 records:               ${missingFts5Records}`);
console.log(`Missing embeddings:                  ${missingEmbeddings}`);
console.log('==========================================================================');
