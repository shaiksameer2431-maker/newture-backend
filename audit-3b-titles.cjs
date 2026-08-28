// AUDIT 3b: title distribution fix + actual content samples
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve('./data/database.db');
const db = new Database(dbPath, { readonly: true });

console.log('========== TITLE DISTRIBUTION ==========\n');
const titles = db.prepare(`
  SELECT title, COUNT(*) AS c
  FROM website_pages
  GROUP BY title
  ORDER BY c DESC
  LIMIT 20
`).all();
for (const t of titles) console.log(`${(t.title || '(null)').slice(0,80).padEnd(80)} ${t.c}`);

// Sample 3 pages with full content
console.log('\n========== CONTENT SAMPLES (3 random) ==========\n');
const pages = db.prepare(`
  SELECT url, title, content
  FROM website_pages
  WHERE is_active = 1 AND length(content) > 1000
  ORDER BY RANDOM()
  LIMIT 3
`).all();
for (const p of pages) {
  console.log('===== URL:', p.url);
  console.log('===== TITLE:', p.title);
  console.log(p.content.slice(0, 2000));
  console.log('--- (truncated) ---\n');
}

db.close();