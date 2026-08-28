import { getDb } from './src/database/db.js';

const db = getDb();

const pageCols = db.prepare(`PRAGMA table_info(website_pages)`).all();
console.log("website_pages columns:", pageCols.map((c: any) => c.name));

const chunkCols = db.prepare(`PRAGMA table_info(website_chunks)`).all();
console.log("website_chunks columns:", chunkCols.map((c: any) => c.name));

const pages = db.prepare(`SELECT id, url, title, last_changed, is_active, length(content) len, content_hash FROM website_pages WHERE content LIKE '%Principal%' OR url LIKE '%prinicpal%' OR title LIKE '%Principal%'`).all() as any[];
console.log("Found pages count:", pages.length);

for (const p of pages) {
  console.log(`\n--- PAGE: ${p.url} (ID: ${p.id}, Active: ${p.is_active}, Hash: ${p.content_hash}) ---`);
  const chunks = db.prepare(`SELECT id, page_id, chunk_hash, embedding_json IS NOT NULL as has_embed, length(content) len, content FROM website_chunks WHERE page_id=?`).all(p.id) as any[];
  console.log(`Page has ${chunks.length} chunks:`);
  for (const c of chunks) {
    console.log(`  Chunk ID: ${c.id}, Has Embed: ${c.has_embed}, ChunkHash: ${c.chunk_hash}`);
    const lines = c.content.split('\n').filter((l: string) => l.toLowerCase().includes('principal') || l.toLowerCase().includes('raviprasad') || l.toLowerCase().includes('venkateswarlu'));
    lines.forEach((l: string) => console.log(`    Line: ${l.trim()}`));
  }
}
