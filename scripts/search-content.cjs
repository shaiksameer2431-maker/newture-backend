// search-content.cjs - Standard CommonJS to search SQLite database directly.
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../data/database.db');
console.log('Opening database at:', dbPath);
const db = new Database(dbPath, { readonly: true });

const terms = ['admission', 'eligibility', 'criteria', 'fee', 'hostel', 'canteen', 'placement', 'research', 'mela', 'prospectus'];

console.log('=== SEARCHING DATABASE FOR KEYWORDS ===\n');

for (const term of terms) {
  const rows = db.prepare(`
    SELECT c.id, c.content, p.url, p.title, p.is_active 
    FROM website_chunks c 
    JOIN website_pages p ON p.id = c.page_id 
    WHERE c.content LIKE ? OR p.title LIKE ? OR p.url LIKE ?
  `).all(`%${term}%`, `%${term}%`, `%${term}%`);
  
  console.log(`Term: "${term}" - Found ${rows.length} chunks.`);
  // Log top unique URLs
  const uniqueUrls = new Set();
  const samples = [];
  for (const r of rows) {
    if (!uniqueUrls.has(r.url)) {
      uniqueUrls.add(r.url);
      samples.push(r);
    }
  }
  console.log(`Unique URLs (${uniqueUrls.size}):`);
  for (const s of samples.slice(0, 5)) {
    console.log(`  - ${s.url} | title: "${s.title}" | chunk: ${s.id.slice(0, 8)} | active: ${s.is_active} | content snippet: "${s.content.replace(/\s+/g, ' ').slice(0, 150)}..."`);
  }
  console.log();
}
