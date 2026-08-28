import { drainAllPendingWebsiteChunks } from './src/services/semanticRag.js';
import { getDb, rebuildWebsiteKnowledgeFts } from './src/database/db.js';

const db = getDb();

async function runDrain() {
  console.log("==================================================");
  console.log("DRAINING EMBEDDING BACKLOG FOR ALL ACTIVE CHUNKS");
  console.log("==================================================");

  const beforePending = (db.prepare("SELECT count(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1 AND trim(c.content)<>'' AND c.embedding_json IS NULL").get() as any).n;
  console.log(`Initial Pending Embeddings: ${beforePending}`);

  const startTime = Date.now();
  const drainRes = await drainAllPendingWebsiteChunks();
  const elapsedSec = Math.round((Date.now() - startTime) / 1000);

  console.log(`\nBacklog Drain Finished in ${elapsedSec}s:`);
  console.log(`  Processed: ${drainRes.totalProcessed}`);
  console.log(`  Failed   : ${drainRes.totalFailed}`);

  // Rebuild FTS5 index
  const ftsRes = rebuildWebsiteKnowledgeFts(db);
  console.log(`FTS5 Index Rebuild: ${ftsRes.count} active chunks indexed`);

  const totalChunks = (db.prepare("SELECT count(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1").get() as any).n;
  const embeddedChunks = (db.prepare("SELECT count(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1 AND c.embedding_json IS NOT NULL").get() as any).n;
  const remainingPending = totalChunks - embeddedChunks;

  console.log("\n==================================================");
  console.log("FINAL EMBEDDING BACKLOG COVERAGE");
  console.log("==================================================");
  console.log(`Total Active Chunks : ${totalChunks}`);
  console.log(`Embedded Chunks     : ${embeddedChunks}`);
  console.log(`Pending Embeddings  : ${remainingPending}`);
  console.log(`Embedding Coverage  : ${Math.round((embeddedChunks / totalChunks) * 100)}%`);

  if (remainingPending === 0) {
    console.log("\n>>> EMBEDDING BACKLOG 100% DRAINED! <<<");
  }
}

runDrain().catch(err => {
  console.error("Drain error:", err);
  process.exit(1);
});
