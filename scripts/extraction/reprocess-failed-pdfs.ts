/**
 * reprocess-failed-pdfs.ts — Reprocess all previously failed/empty NECN PDFs
 * using the new universal multi-layered PDF extraction engine.
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import crypto from 'node:crypto';
import { getDb } from '../../src/database/db.js';
import { extractPdfDocument, savePdfPageExtractions } from '../../src/services/pdfExtractor.js';
import { chunkStructuredText } from '../../src/services/chunker.js';
import { cleanPageContent } from '../../src/services/contentCleaner.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

async function fetchPdfBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(30000)
    });
    if (res.ok) {
      return Buffer.from(await res.arrayBuffer());
    }
  } catch { /* try curl fallback */ }

  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const execFileAsync = promisify(execFile);

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf-reprocess-'));
    const bodyFile = path.join(tempDir, 'body.bin');
    const args = [
      '--ipv4', '--location', '--silent', '--show-error', '--compressed',
      '--max-time', '60', '--connect-timeout', '15',
      '--user-agent', USER_AGENT, '--output', bodyFile, url
    ];
    await execFileAsync('curl.exe', args, { maxBuffer: 1024 * 1024 });
    const buf = await fs.promises.readFile(bodyFile);
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('========================================');
  console.log('REPROCESSING PREVIOUSLY FAILED NECN PDFs');
  console.log('========================================\n');

  const db = getDb();

  // Find all PDF URLs recorded in crawl_errors or crawl_job_urls or website_pages with failed status
  const failedPdfRows = db.prepare(`
    SELECT DISTINCT url FROM (
      SELECT url FROM crawl_errors WHERE url LIKE '%.pdf%'
      UNION
      SELECT url FROM crawl_job_urls WHERE url LIKE '%.pdf%' AND state IN ('FAILED', 'QUEUED')
      UNION
      SELECT url FROM website_pages WHERE url LIKE '%.pdf%' AND (length(content) < 50 OR content LIKE '%empty%')
    ) ORDER BY url
  `).all() as Array<{ url: string }>;

  console.log(`Found ${failedPdfRows.length} target PDF URL(s) to evaluate and reprocess.\n`);

  let reprocessedCount = 0;
  let totalPagesExtracted = 0;
  let totalChunksCreated = 0;
  let failedCount = 0;

  for (const row of failedPdfRows) {
    const url = row.url;
    console.log(`Processing: ${url}`);
    
    const buffer = await fetchPdfBuffer(url);
    if (!buffer) {
      console.warn(`  -> Could not download PDF buffer for ${url}`);
      failedCount++;
      continue;
    }

    const pdfResult = await extractPdfDocument(buffer, { maxMs: 60000 });
    console.log(`  -> Status: ${pdfResult.extractionStatus}, Pages: ${pdfResult.pageCount}, TextLen: ${pdfResult.textLength}, Score: ${pdfResult.qualityScore}`);

    if (!pdfResult.ok && pdfResult.textLength < 40) {
      console.warn(`  -> Extraction insufficient: ${pdfResult.reason || pdfResult.extractionStatus}`);
      failedCount++;
      continue;
    }

    const content = pdfResult.fullText;
    const title = (pdfResult.title && pdfResult.title !== 'NECN Official Document' && pdfResult.title !== 'Corrupted PDF')
      ? pdfResult.title
      : url.split('/').pop()?.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ') || 'NECN Official PDF';

    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const existing = db.prepare('SELECT id FROM website_pages WHERE url = ?').get(url) as any;
    const pageId = existing?.id || crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO website_pages (id, url, title, category, content, content_hash, http_status, content_type, last_crawled, last_changed, is_active, clean_title, clean_content_hash)
      VALUES (?, ?, ?, 'Official Documents', ?, ?, 200, 'application/pdf', ?, ?, 1, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        title = excluded.title, content = excluded.content, content_hash = excluded.content_hash,
        http_status = 200, last_crawled = excluded.last_crawled, last_changed = excluded.last_changed,
        is_active = 1, clean_title = excluded.clean_title, clean_content_hash = excluded.clean_content_hash
    `).run(pageId, url, title, content, hash, now, now, title, hash);

    // Save page details into website_pdf_pages
    savePdfPageExtractions(db, pageId, pdfResult);

    // Rechunk document
    db.prepare('DELETE FROM website_chunks WHERE page_id = ?').run(pageId);
    const structuredChunks = chunkStructuredText(content);
    const insertChunk = db.prepare(`
      INSERT INTO website_chunks (id, page_id, heading, content, chunk_index, keywords, chunk_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction(() => {
      for (const chunk of structuredChunks) {
        insertChunk.run(
          crypto.randomUUID(), pageId, chunk.heading, chunk.content, chunk.index,
          `${title} ${chunk.content}`.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.slice(0, 50).join(',') || '',
          crypto.createHash('sha256').update(chunk.content).digest('hex').slice(0, 16),
          now
        );
      }
    });
    insertMany();

    // Mark as CRAWLED in crawl_job_urls
    db.prepare("UPDATE crawl_job_urls SET state='CRAWLED', http_status=200, last_error=NULL, completed_at=? WHERE url=?")
      .run(now, url);

    reprocessedCount++;
    totalPagesExtracted += pdfResult.pageCount;
    totalChunksCreated += structuredChunks.length;
  }

  console.log('\n========================================');
  console.log('REPROCESSING COMPLETE SUMMARY');
  console.log('========================================');
  console.log(`PDFs Reprocessed Successfully: ${reprocessedCount}`);
  console.log(`Total Pages Extracted:        ${totalPagesExtracted}`);
  console.log(`Total Chunks Created:         ${totalChunksCreated}`);
  console.log(`PDFs Failed / Remaining:      ${failedCount}`);
  console.log('========================================');
}

main().catch(err => {
  console.error('Fatal error in PDF reprocessing script:', err);
  process.exitCode = 1;
});
