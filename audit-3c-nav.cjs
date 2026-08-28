// AUDIT 3c: detect navigation chrome and find the actual unique content
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve('./data/database.db');
const db = new Database(dbPath, { readonly: true });

// Locate the longest common prefix across the random sample
const pages = db.prepare(`
  SELECT id, url, title, content
  FROM website_pages
  WHERE is_active = 1 AND length(content) > 1000
  ORDER BY RANDOM()
  LIMIT 50
`).all();

function longestCommonPrefix(strs) {
  if (!strs.length) return '';
  let prefix = strs[0];
  for (const s of strs.slice(1)) {
    while (!s.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return '';
    }
  }
  return prefix;
}

const strings = pages.map(p => p.content);
const lcp = longestCommonPrefix(strings);
console.log(`Longest common prefix length across 50 random pages: ${lcp.length} chars`);
console.log(`LCP preview:\n${lcp.slice(0, 600)}`);
console.log(`...\nLCP end:\n${lcp.slice(-400)}`);

// How many pages have >X% of content equal to the LCP/known boilerplate?
const NAV_MARK = 'NEC Nellore | Narayana Engineering College';
const pagesAll = db.prepare(`SELECT id, url, length(content) AS len FROM website_pages WHERE is_active = 1`).all();
let mostlyNav = 0;
for (const p of pagesAll) {
  const row = db.prepare(`SELECT content FROM website_pages WHERE id = ?`).get(p.id);
  const c = row.content || '';
  if (c.startsWith(NAV_MARK) && c.indexOf(NAV_MARK, 1) > -1) {
    const firstEnd = c.indexOf(NAV_MARK, 1);
    const navLen = firstEnd;
    if (navLen / p.len > 0.3) mostlyNav++;
  }
}
console.log(`\nPages where nav-prefix dominates >30% of content: ${mostlyNav}`);

// Show actual unique content for one page (skip nav)
console.log('\n--- One page (skip first 2000 chars) ---');
const one = db.prepare(`SELECT url, content FROM website_pages WHERE is_active = 1 AND length(content) > 4000 ORDER BY RANDOM() LIMIT 1`).get();
console.log('URL:', one.url);
console.log('Content (chars 2000-5000):');
console.log(one.content.slice(2000, 5000));
console.log('...\nContent (chars 5000-7000):');
console.log(one.content.slice(5000, 7000));

db.close();
