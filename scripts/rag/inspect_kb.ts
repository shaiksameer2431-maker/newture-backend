import { getDb } from './src/database/db.js';

const db = getDb();

console.log("=== CHUNKS CONTAINING 'HOD' or 'Head of' ===");
const hodChunks = db.prepare(`SELECT c.id, c.content, p.title, p.url FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1 AND (c.content LIKE '%HOD%' OR c.content LIKE '%Head of%')`).all() as any[];

console.log(`Found ${hodChunks.length} chunks.`);
for (const c of hodChunks) {
  const lines = c.content.split('\n').filter((l: string) => /hod|head of|principal/i.test(l));
  console.log(`\nURL: ${c.url} (${c.title})`);
  lines.forEach((l: string) => console.log(`  > ${l.trim()}`));
}

console.log("\n=== CHUNKS CONTAINING 'Admission' AND ('Contact' OR 'Phone' OR 'Office' OR 'Apply') ===");
const admChunks = db.prepare(`SELECT c.id, c.content, p.title, p.url FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1 AND (c.content LIKE '%admission%')`).all() as any[];
console.log(`Found ${admChunks.length} admission chunks.`);
for (const c of admChunks.slice(0, 15)) {
  console.log(`\nURL: ${c.url} (${c.title})`);
  const lines = c.content.split('\n').filter((l: string) => /contact|phone|office|apply|procedure|require|guideline|apsche|eapcet|ecet|icet/i.test(l));
  lines.slice(0, 5).forEach((l: string) => console.log(`  > ${l.trim()}`));
}
