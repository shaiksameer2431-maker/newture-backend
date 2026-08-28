// AUDIT 4: PDF content audit
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve('./data/database.db');
const db = new Database(dbPath, { readonly: true });

console.log('========== PDF AUDIT ==========\n');

// All PDF pages (URL or content_type)
const pdfs = db.prepare(`
  SELECT url, title, content_type, length(content) AS len, content, http_status, last_crawled
  FROM website_pages
  WHERE url LIKE '%.pdf' OR (content_type IS NOT NULL AND content_type LIKE '%pdf%')
  ORDER BY url
`).all();
console.log(`Total PDF pages: ${pdfs.length}\n`);
for (const p of pdfs) {
  console.log(`URL: ${p.url}`);
  console.log(`  status=${p.http_status} ctype=${p.content_type} content_len=${p.len}`);
  console.log(`  title=${p.title}`);
  const preview = (p.content || '').slice(0, 300).replace(/\s+/g, ' ');
  console.log(`  preview: ${preview}`);
  console.log('');
}

// crawl_errors for PDF related stages
console.log('\n--- PDF-related crawl_errors ---');
const pdfErrs = db.prepare(`
  SELECT url, http_status, error_message, stage, retry_count
  FROM crawl_errors
  WHERE stage IN ('pdf_extraction','skipped_due_to_size')
  ORDER BY created_at DESC
  LIMIT 30
`).all();
for (const e of pdfErrs) console.log(`  [${e.stage}] ${e.url} | ${e.http_status} | ${e.error_message}`);

// Stats on PDF extraction success
const allPdfAttempts = db.prepare(`
  SELECT
    CASE
      WHEN stage = 'pdf_extraction' THEN 'failed_extraction'
      WHEN stage = 'skipped_due_to_size' THEN 'too_large'
      WHEN stage = 'acquisition' THEN 'acquisition_failed'
    END AS outcome,
    COUNT(*) AS c
  FROM crawl_errors
  WHERE stage IN ('pdf_extraction','skipped_due_to_size','acquisition')
  GROUP BY outcome
`).all();
console.log('\n--- PDF errors by stage ---');
for (const r of allPdfAttempts) console.log(`  ${r.outcome}: ${r.c}`);

// Discovered PDFs vs successful PDFs
const discovered = db.prepare(`
  SELECT COUNT(*) AS c FROM crawl_job_urls WHERE url LIKE '%.pdf' OR (mime_type IS NOT NULL AND mime_type LIKE '%pdf%')
`).get();
console.log(`\nPDF URLs in crawl_job_urls: ${discovered.c}`);

const successCrawled = db.prepare(`
  SELECT COUNT(*) AS c FROM crawl_job_urls
  WHERE (url LIKE '%.pdf' OR (mime_type LIKE '%pdf%'))
  AND state = 'CRAWLED'
`).get();
console.log(`PDFs successfully CRAWLED: ${successCrawled.c}`);

const failedCrawled = db.prepare(`
  SELECT COUNT(*) AS c FROM crawl_job_urls
  WHERE (url LIKE '%.pdf' OR (mime_type LIKE '%pdf%'))
  AND state = 'FAILED'
`).get();
console.log(`PDFs FAILED: ${failedCrawled.c}`);

db.close();
