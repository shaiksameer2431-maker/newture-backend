import { getDb, rebuildWebsiteKnowledgeFts } from './src/database/db.js';
import { crawlWebsite } from './src/services/websiteCrawler.js';
import { drainAllPendingWebsiteChunks } from './src/services/semanticRag.js';

async function main() {
  console.log("==================================================");
  console.log("INCREMENTAL SYNCHRONIZATION RUN");
  console.log("==================================================");

  const db = getDb();
  
  // 1. Run controlled crawler sync on official NECN site
  console.log("[SYNC] Launching crawler sync for official NECN site...");
  const crawlResult = await crawlWebsite({
    startUrl: 'https://necn.ac.in/',
    maxPages: 1000,
    type: 'INCREMENTAL'
  });

  console.log("[SYNC] Crawl result:", crawlResult);

  // 2. Drain any pending chunk embeddings
  console.log("[SYNC] Draining pending embeddings...");
  const embedRes = await drainAllPendingWebsiteChunks();
  console.log("[SYNC] Embedding backlog drained:", embedRes);

  // 3. Rebuild/update FTS index
  console.log("[SYNC] Rebuilding FTS index...");
  const ftsRes = rebuildWebsiteKnowledgeFts(db);
  console.log("[SYNC] FTS result:", ftsRes);

  // 4. Verify Principal records in database
  const pages = db.prepare(`SELECT id, url, title, last_changed, is_active FROM website_pages WHERE content LIKE '%Principal%' OR url LIKE '%prinicpal%'`).all() as any[];
  console.log("\n[VERIFY] Database Principal pages count:", pages.length);

  const chunks = db.prepare(`SELECT c.id, c.content, p.url FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE c.content LIKE '%Principal%' OR c.content LIKE '%Raviprasad%' OR c.content LIKE '%Venkateswarlu%'`).all() as any[];
  console.log(`[VERIFY] Database Principal chunks count: ${chunks.length}`);
  chunks.forEach(c => {
    console.log(`  [CHUNK] ${c.url} -> ${c.content.replace(/\s+/g, ' ').slice(0, 150)}`);
  });
}

main().catch(err => {
  console.error("Incremental sync crashed:", err);
  process.exit(1);
});
