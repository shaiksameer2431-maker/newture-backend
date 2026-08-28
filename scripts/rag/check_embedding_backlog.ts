import { getDb } from './src/database/db.js';
import { semanticRagStatus } from './src/services/semanticRag.js';

const db = getDb();
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';

const totalChunks = (db.prepare('SELECT count(*) n FROM website_chunks').get() as any).n;
const eligibleChunks = (db.prepare("SELECT count(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1 AND trim(c.content)<>''").get() as any).n;
const embeddedChunks = (db.prepare("SELECT count(*) n FROM website_chunks WHERE embedding_json IS NOT NULL AND embedding_model = ?").get(EMBEDDING_MODEL) as any).n;
const pendingChunks = (db.prepare("SELECT count(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1 AND trim(c.content)<>'' AND (c.embedding_json IS NULL OR c.embedding_model <> ?)").get(EMBEDDING_MODEL) as any).n;
const failedChunks = (db.prepare("SELECT count(*) n FROM website_chunks WHERE embedding_json IS NULL AND embedded_at IS NOT NULL").get() as any).n;

console.log("==========================================");
console.log("DATABASE EMBEDDING BACKLOG INSPECTION");
console.log("==========================================");
console.log(`TOTAL_CHUNKS          : ${totalChunks}`);
console.log(`TOTAL_ELIGIBLE_CHUNKS : ${eligibleChunks}`);
console.log(`EMBEDDED              : ${embeddedChunks}`);
console.log(`PENDING               : ${pendingChunks}`);
console.log(`FAILED                : ${failedChunks}`);
console.log(`semanticRagStatus     :`, semanticRagStatus());
