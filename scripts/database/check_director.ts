import { getDb } from './src/database/db.js';

const db = getDb();

console.log("Checking Director records in database...");
const pages = db.prepare(`SELECT url, title, content FROM website_pages WHERE is_active=1 AND (url LIKE '%director%' OR title LIKE '%Director%' OR content LIKE '%Director%')`).all() as any[];

console.log(`Found ${pages.length} pages mentioning Director:`);
for (const p of pages) {
  console.log(`- ${p.title} (${p.url})`);
  const lines = p.content.split('\n').filter((l: string) => l.toLowerCase().includes('director'));
  console.log(`  Sample: ${lines.slice(0, 3).join(' | ')}`);
}
