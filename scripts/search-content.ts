// search-content.ts - Search the SQLite database for specific terms to find actual content.
import { getDb } from '../src/database/db.js';

const terms = ['admission', 'eligibility', 'criteria', 'fee', 'hostel', 'canteen', 'placement', 'research', 'mela', 'prospectus'];

const db = getDb();
console.log('=== SEARCHING DATABASE FOR KEYWORDS ===\n');

for (const term of terms) {
  const rows = db.prepare(`
    SELECT c.id, c.content, p.url, p.title 
    FROM website_chunks c 
    JOIN website_pages p ON p.id = c.page_id 
    WHERE c.content LIKE ? OR p.title LIKE ? OR p.url LIKE ?
  `).all(`%${term}%`, `%${term}%`, `%${term}%`) as any[];
  
  console.log(`Term: "${term}" - Found ${rows.length} chunks.`);
  // Log top 3 unique URLs
  const uniqueUrls = new Set<string>();
  const samples: any[] = [];
  for (const r of rows) {
    if (!uniqueUrls.has(r.url)) {
      uniqueUrls.add(r.url);
      samples.push(r);
    }
  }
  console.log(`Unique URLs (${uniqueUrls.size}):`);
  for (const s of samples.slice(0, 5)) {
    console.log(`  - ${s.url} | title: "${s.title}" | chunk: ${s.id.slice(0, 8)} | content snippet: "${s.content.replace(/\s+/g, ' ').slice(0, 150)}..."`);
  }
  console.log();
}
