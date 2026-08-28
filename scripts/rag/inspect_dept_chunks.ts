import { getDb } from './src/database/db.js';

const db = getDb();

console.log("=== CHECKING ALL CHUNKS CONTAINING 'HOD' OR 'Head' OR 'Department' OR 'Principal' OR 'Admission' ===");
const rows = db.prepare(`
  SELECT c.id, c.content, p.title, p.url, p.category 
  FROM website_chunks c 
  JOIN website_pages p ON p.id = c.page_id 
  WHERE p.is_active = 1 AND (
    c.content LIKE '%HOD%' OR 
    c.content LIKE '%Head of%' OR 
    c.content LIKE '%Principal%' OR 
    c.content LIKE '%admission%' OR
    c.content LIKE '%contact%'
  )
`).all() as any[];

console.log(`Found ${rows.length} matching chunks.`);

// Group by URL
const byUrl = new Map<string, any[]>();
for (const r of rows) {
  if (!byUrl.has(r.url)) byUrl.set(r.url, []);
  byUrl.get(r.url)!.push(r);
}

for (const [url, chunks] of byUrl.entries()) {
  console.log(`\n========================================`);
  console.log(`PAGE: ${chunks[0].title} (${url}) - ${chunks.length} chunk(s)`);
  console.log(`========================================`);
  for (const c of chunks) {
    console.log(`--- CHUNK ${c.id} ---`);
    console.log(c.content);
  }
}
