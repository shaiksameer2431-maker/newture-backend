import { getDb } from './src/database/db.js';

const db = getDb();

function searchChunks(kw: string, limit = 3) {
  const rows = db.prepare(`SELECT c.id, c.content, p.title, p.url FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1 AND lower(c.content) LIKE lower(?) LIMIT ?`).all(`%${kw}%`, limit) as any[];
  console.log(`\n--- SEARCH KEYWORD: "${kw}" (${rows.length} hits) ---`);
  for (const r of rows) {
    console.log(`[URL] ${r.url} | [TITLE] ${r.title}`);
    console.log(`[CONTENT] ${r.content.replace(/\s+/g, ' ').slice(0, 200)}...`);
  }
}

searchChunks('hod');
searchChunks('principal');
searchChunks('admission');
searchChunks('facilities');
searchChunks('address');
searchChunks('email');
searchChunks('attendance');
searchChunks('vision');
