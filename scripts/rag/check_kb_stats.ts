import { getDb } from './src/database/db.js';

const db = getDb();
const totalPages = (db.prepare("SELECT count(*) n FROM website_pages WHERE is_active=1").get() as any).n;
const totalChunks = (db.prepare("SELECT count(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1").get() as any).n;
const embeddedChunks = (db.prepare("SELECT count(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1 AND c.embedding_json IS NOT NULL").get() as any).n;
const pendingChunks = totalChunks - embeddedChunks;

console.log("==========================================");
console.log("CURRENT KNOWLEDGE BASE STATS");
console.log("==========================================");
console.log(`Active Website Pages  : ${totalPages}`);
console.log(`Active Text Chunks    : ${totalChunks}`);
console.log(`Embedded Chunks       : ${embeddedChunks}`);
console.log(`Pending Embeddings    : ${pendingChunks}`);
