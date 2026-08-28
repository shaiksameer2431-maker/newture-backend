/**
 * scripts/rebuild-knowledge-base.ts
 *
 * One-shot CLI that:
 *   1. Backs up data/database.db to data/backups/database.rebuild-{ts}.bak
 *   2. In a single SQLite transaction, re-cleans, re-titles, re-chunks every
 *      active website_pages row using contentCleaner + chunker + detector.
 *   3. Updates website_chunks (the triggers keep chunks_fts in sync).
 *
 * Safe to run while the live crawler is operating — the crawler only writes
 * to website_pages / website_chunks (and triggers keep FTS5 consistent), and
 * the rebuild touches no crawl_* tables.
 *
 * Usage:
 *   npm run rebuild-kb
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, getDbPath, ensureWebsiteKnowledgeFts, fts5Available } from '../src/database/db.js';
import { cleanPageContent, extractMeaningfulTitle, detectSectionMetadata, detectChromeBlocks } from '../src/services/contentCleaner.js';
import { chunkStructuredText } from '../src/services/chunker.js';

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function keywordsFor(content: string): string {
  const stop = new Set([
    'the','and','for','with','from','that','this','are','was','were','has','have','will','into','your','their','about',
    'college','engineering','department','professor','assistant','associate'
  ]);
  const counts = new Map<string, number>();
  for (const token of (content.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])) {
    if (stop.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([k]) => k).join(',');
}

async function main() {
  const db = getDb();
  ensureWebsiteKnowledgeFts(db);

  console.log('[REBUILD] NECN Knowledge-Base Quality V2 rebuild');
  console.log(`[REBUILD] FTS5 available: ${fts5Available()}`);

  const dbPath = getDbPath();
  const backupsDir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  const backupPath = path.join(backupsDir, `database.rebuild-${stamp()}.bak`);
  console.log(`[REBUILD] Creating backup: ${backupPath}`);
  try {
    db.backup(backupPath);
  } catch (e) {
    console.error('[REBUILD] Backup failed:', e instanceof Error ? e.message : e);
    process.exit(2);
  }

  // Active-crawl coexistence: warn but don't stop.
  const activeJobs = db.prepare("SELECT COUNT(*) AS n FROM crawl_jobs WHERE status='running'").get() as { n: number };
  if (activeJobs.n > 0) {
    console.warn(`[REBUILD] WARNING: ${activeJobs.n} crawl job(s) are still running.`);
    console.warn('[REBUILD] The rebuild will run concurrently; SQLite WAL mode serializes writes per row.');
  }

  const beforePages = (db.prepare('SELECT COUNT(*) AS n FROM website_pages WHERE is_active=1').get() as { n: number }).n;
  const beforeChunks = (db.prepare('SELECT COUNT(*) AS n FROM website_chunks').get() as { n: number }).n;
  if (beforePages === 0) {
    console.log('[REBUILD] Nothing to rebuild (no active pages). Exiting.');
    process.exit(0);
  }
  console.log(`[REBUILD] Before: ${beforePages} active pages, ${beforeChunks} chunks`);

  // Phase 1 — read pages and compute the chrome map (read-only).
  const pages = db.prepare(`SELECT id, url, title, content FROM website_pages WHERE is_active=1`).all() as Array<{
    id: string; url: string; title: string; content: string;
  }>;
  console.log(`[REBUILD] Detecting chrome blocks across ${pages.length} pages...`);
  const chromeMap = detectChromeBlocks(pages.map(p => ({ url: p.url, content: p.content })), { minOccurrences: 3 });
  console.log(`[REBUILD] Detected ${chromeMap.size} recurring chrome blocks.`);

  // Phase 2 — transactional rewrite.
  console.log('[REBUILD] Rebuilding pages inside a single transaction...');
  const insertChunk = db.prepare(`INSERT INTO website_chunks
    (id, page_id, heading, content, chunk_index, keywords, section, department, start_offset, end_offset, chunk_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const updatePage = db.prepare(`UPDATE website_pages SET
      title=?, content=?, clean_title=?, section=?, department=?, clean_content_hash=?,
      last_changed=CASE WHEN content_hash != ? THEN ? ELSE last_changed END,
      content_hash=?
    WHERE id=?`);
  const deleteChunks = db.prepare('DELETE FROM website_chunks WHERE page_id=?');

  let navPrefixRemoved = 0, duplicatedBlocksRemoved = 0, unchangedAfterClean = 0;
  let totalNewChunks = 0;

  const run = db.transaction(() => {
    for (const page of pages) {
      const beforeLen = page.content.length;
      const cleaned = cleanPageContent(page.content, { source: 'rebuild', chromeMap });
      const afterLen = cleaned.length;

      if (afterLen >= beforeLen) {
        // No chrome was found; nothing to do for this page.
        unchangedAfterClean++;
        continue;
      }

      const cleanTitle = extractMeaningfulTitle(page.content, page.url, { source: 'rebuild' });
      const section = detectSectionMetadata(page.url, page.content);
      const chunks = chunkStructuredText(cleaned);
      const newHash = crypto.createHash('sha256').update(cleaned).digest('hex');
      const now = new Date().toISOString();

      // Triggers will sync chunks_fts automatically.
      deleteChunks.run(page.id);
      for (const c of chunks) {
        const chunkHash = crypto.createHash('sha256').update(c.content).digest('hex').slice(0, 16);
        insertChunk.run(
          crypto.randomUUID(), page.id, c.heading, c.content, c.index,
          keywordsFor(`${cleanTitle} ${c.content}`),
          section.section, section.department, c.startOffset, c.endOffset,
          chunkHash, now
        );
      }
      totalNewChunks += chunks.length;
      updatePage.run(
        cleanTitle, cleaned, cleanTitle,
        section.section, section.department, newHash,
        newHash, now, newHash, page.id
      );

      if (afterLen < beforeLen * 0.7) duplicatedBlocksRemoved++;
      else navPrefixRemoved++;
    }
  });

  try {
    run();
  } catch (e) {
    console.error('[REBUILD] Transaction failed; database rolled back:', e instanceof Error ? e.message : e);
    console.error(`[REBUILD] Restore with: cp "${backupPath}" "${dbPath}" && rm -f "${dbPath}-wal" "${dbPath}-shm"`);
    process.exit(3);
  }

  // Defensive: refresh FTS index from chunks (in case triggers ever fell behind).
  try {
    if (fts5Available()) {
      db.exec(`INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')`);
    }
  } catch (e) {
    console.warn('[REBUILD] FTS rebuild statement skipped:', e instanceof Error ? e.message : e);
  }

  const afterPages = (db.prepare('SELECT COUNT(*) AS n FROM website_pages WHERE is_active=1').get() as { n: number }).n;
  const afterChunks = (db.prepare('SELECT COUNT(*) AS n FROM website_chunks').get() as { n: number }).n;
  const ftsRows = fts5Available() ? (db.prepare('SELECT COUNT(*) AS n FROM chunks_fts').get() as { n: number }).n : 0;
  const crawlJobs = (db.prepare("SELECT COUNT(*) AS n FROM crawl_jobs WHERE status='running'").get() as { n: number }).n;

  console.log('[REBUILD] DONE');
  console.log(`  pages rewritten:               ${pages.length - unchangedAfterClean}`);
  console.log(`  pages unchanged after clean:  ${unchangedAfterClean}`);
  console.log(`  pages where nav prefix dominated:        ${navPrefixRemoved}`);
  console.log(`  pages where duplicated blocks were significant: ${duplicatedBlocksRemoved}`);
  console.log(`  pages active (after):         ${afterPages}`);
  console.log(`  chunks before:                ${beforeChunks}`);
  console.log(`  chunks after:                 ${afterChunks}`);
  console.log(`  fts rows:                     ${ftsRows}`);
  console.log(`  crawl_jobs still running:     ${crawlJobs}`);
  console.log(`  backup:                       ${backupPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[REBUILD] Fatal:', err);
  process.exit(1);
});
