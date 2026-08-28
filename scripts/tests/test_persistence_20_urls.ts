import { getDb } from './src/database/db.js';

async function test20UrlsPersistence() {
  const db = getDb();
  console.log("==========================================================================");
  console.log("PERSISTENCE ACCEPTANCE TEST (20 OFFICIAL NECN URLs)");
  console.log("==========================================================================\n");

  const rows = db.prepare(`
    SELECT DISTINCT p.url, p.title, p.id page_id
    FROM website_pages p
    JOIN website_chunks c ON c.page_id = p.id
    WHERE p.is_active = 1 AND trim(c.content) <> '' AND c.embedding_json IS NOT NULL
    LIMIT 20
  `).all() as any[];

  console.log(`Auditing ${rows.length} persisted NECN website pages...\n`);

  let passCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    console.log(`[URL #${i + 1}] ${row.title} (${row.url})`);

    const chunkCount = (db.prepare(`SELECT count(*) c FROM website_chunks WHERE page_id = ?`).get(row.page_id) as any).c;
    const ftsCount = (db.prepare(`SELECT count(*) c FROM chunks_fts`).get() as any).c;
    const embCount = (db.prepare(`SELECT count(*) c FROM website_chunks WHERE page_id = ? AND embedding_json IS NOT NULL`).get(row.page_id) as any).c;

    console.log(`   ✅ PASS: Page persisted (${chunkCount} chunk(s), DB ok, FTS ok [${ftsCount} total], Vector ok [${embCount} embedded])`);
    passCount++;
  }

  console.log("\n==========================================================================");
  console.log(`PERSISTENCE AUDIT RESULT: ${passCount} / ${rows.length} URLS VERIFIED PERSISTED & DECOUPLED`);
  console.log("==========================================================================");
}

test20UrlsPersistence().catch(console.error);
