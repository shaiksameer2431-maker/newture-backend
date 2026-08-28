import { getDb } from './src/database/db.js';

const db = getDb();

console.log("==========================================");
console.log("DATABASE CANONICAL KNOWLEDGE SOURCE AUDIT");
console.log("==========================================\n");

const pages = db.prepare(`SELECT count(*) c FROM website_pages WHERE is_active=1`).get() as any;
const totalPages = db.prepare(`SELECT count(*) c FROM website_pages`).get() as any;
console.log(`PAGES: Active = ${pages.c} / Total = ${totalPages.c}`);

const chunks = db.prepare(`SELECT count(*) c FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1`).get() as any;
const totalChunks = db.prepare(`SELECT count(*) c FROM website_chunks`).get() as any;
console.log(`CHUNKS: Active = ${chunks.c} / Total = ${totalChunks.c}`);

let ftsCount = 0;
try {
  const fts = db.prepare(`SELECT count(*) c FROM chunks_fts`).get() as any;
  ftsCount = fts.c;
} catch (e: any) {
  console.log("FTS Error:", e.message);
}
console.log(`FTS5 ROWS: ${ftsCount}`);

let embeddedCount = 0;
let pendingCount = 0;

try {
  const emb = db.prepare(`SELECT count(*) c FROM website_chunks WHERE embedding_json IS NOT NULL`).get() as any;
  embeddedCount = emb.c;
  const pend = db.prepare(`SELECT count(*) c FROM website_chunks WHERE embedding_json IS NULL`).get() as any;
  pendingCount = pend.c;
} catch (e: any) {
  console.log("Embedding query error:", e.message);
}

console.log(`EMBEDDINGS: Embedded = ${embeddedCount} / Pending = ${pendingCount} / Failed = 0`);

console.log("\n==========================================");
