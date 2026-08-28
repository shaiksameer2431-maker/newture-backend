import { getDb } from './src/database/db.js';

const db = getDb();
console.log("Cleaning up inactive page chunks from SQLite database...");

const res = db.prepare(`
  DELETE FROM website_chunks
  WHERE page_id IN (SELECT id FROM website_pages WHERE is_active = 0)
`).run();

console.log(`Deleted ${res.changes} inactive chunks from website_chunks.`);

// Drain any remaining active pending embeddings
const totalChunks = (db.prepare('SELECT count(*) n FROM website_chunks').get() as any).n;
const embeddedChunks = (db.prepare('SELECT count(*) n FROM website_chunks WHERE embedding_json IS NOT NULL').get() as any).n;
console.log(`Remaining chunks: Total = ${totalChunks}, Embedded = ${embeddedChunks}, Pending = ${totalChunks - embeddedChunks}`);
