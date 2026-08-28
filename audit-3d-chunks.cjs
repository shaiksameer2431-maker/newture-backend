// AUDIT 3d: website_chunks structure
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve('./data/database.db');
const db = new Database(dbPath, { readonly: true });

console.log('========== CHUNK STRUCTURE ==========\n');

// How many chunks per page?
const chunksPerPage = db.prepare(`
  SELECT
    CASE
      WHEN cnt = 1 THEN '1'
      WHEN cnt = 2 THEN '2'
      WHEN cnt = 3 THEN '3'
      WHEN cnt = 4 THEN '4'
      WHEN cnt = 5 THEN '5'
      WHEN cnt BETWEEN 6 AND 10 THEN '6-10'
      WHEN cnt BETWEEN 11 AND 20 THEN '11-20'
      ELSE '20+'
    END AS bucket,
    COUNT(*) AS pages
  FROM (SELECT page_id, COUNT(*) AS cnt FROM website_chunks GROUP BY page_id)
  GROUP BY bucket
  ORDER BY bucket
`).all();
console.log('--- Chunks per page distribution ---');
for (const r of chunksPerPage) console.log(`  ${r.bucket.padEnd(8)} ${r.pages}`);

const total = db.prepare(`SELECT COUNT(*) AS c FROM website_chunks`).get();
console.log(`Total chunks: ${total.c}`);

const emb = db.prepare(`SELECT COUNT(*) AS c FROM website_chunks WHERE embedding_json IS NOT NULL`).get();
console.log(`Chunks with embedding_json: ${emb.c}`);

// 5 sample chunks
console.log('\n--- 5 sample chunks ---');
const samples = db.prepare(`
  SELECT c.id, c.page_id, c.chunk_index, c.heading, length(c.content) AS len, substr(c.content,1,400) AS preview, p.url
  FROM website_chunks c
  LEFT JOIN website_pages p ON p.id = c.page_id
  ORDER BY RANDOM()
  LIMIT 5
`).all();
for (const s of samples) {
  console.log(`\n[chunk_id=${s.id}] page=${s.url} | idx=${s.chunk_index} | len=${s.len} | heading="${s.heading||''}"`);
  console.log(`  Preview: ${s.preview.replace(/\s+/g,' ').slice(0,300)}`);
}

// What % of chunk content is repetition?
console.log('\n--- Chunk content length distribution ---');
const clens = db.prepare(`SELECT length(content) AS len FROM website_chunks`).all();
const arr = clens.map(r => r.len);
const avg = arr.reduce((a,b)=>a+b,0)/arr.length;
console.log(`Total chunks: ${arr.length}`);
console.log(`Avg len: ${avg.toFixed(0)} chars`);
console.log(`Min len: ${Math.min(...arr)} chars`);
console.log(`Max len: ${Math.max(...arr)} chars`);
const veryShort = arr.filter(l => l < 100).length;
const veryLong = arr.filter(l => l > 2000).length;
console.log(`<100 chars: ${veryShort}`);
console.log(`>2000 chars: ${veryLong}`);

db.close();
