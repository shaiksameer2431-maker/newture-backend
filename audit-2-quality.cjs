// AUDIT 2: content quality - 30 random website_pages
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve('./data/database.db');
const db = new Database(dbPath, { readonly: true });

console.log('========== CONTENT QUALITY AUDIT (30 random pages) ==========\n');

const pages = db.prepare(`
  SELECT id, url, title, category, content, content_type, http_status, length(content) AS len, last_crawled
  FROM website_pages
  WHERE is_active = 1
  ORDER BY RANDOM()
  LIMIT 30
`).all();

const lengths = [];
let empty = 0, nearEmpty = 0, poor = 0, pdfs = 0;
const boilerplateMarkers = ['navigation', 'home', 'login', 'menu', 'skip to content', 'copyright', 'all rights reserved', '©', 'footer', 'sidebar'];

console.log('--- Per-page stats ---');
for (const p of pages) {
  lengths.push(p.len);
  const lower = (p.title || '') + '\n' + (p.content || '').slice(0, 2000);
  const lowerL = lower.toLowerCase();
  const isPdf = (p.url || '').toLowerCase().endsWith('.pdf') || (p.content_type || '').includes('pdf');
  if (isPdf) pdfs++;
  const navHits = boilerplateMarkers.reduce((acc, m) => acc + (lowerL.includes(m) ? 1 : 0), 0);
  const isEmpty = p.len === 0;
  const isNearEmpty = p.len > 0 && p.len < 200;
  if (isEmpty) empty++;
  if (isNearEmpty) nearEmpty++;
  // poor extraction heuristic: very short content, only nav hits, or duplicate header
  if (p.len < 300 || (navHits >= 3 && p.len < 1000)) poor++;
  console.log(`[${p.len.toString().padStart(6)}ch] ${(p.title||'').slice(0,60).padEnd(60)} | ${p.url.slice(0,80)}`);
}

console.log('\n--- Summary ---');
const avg = lengths.reduce((a,b)=>a+b,0) / lengths.length;
const min = Math.min(...lengths);
const max = Math.max(...lengths);
console.log(`Average content length: ${avg.toFixed(0)} chars`);
console.log(`Min content length:     ${min} chars`);
console.log(`Max content length:     ${max} chars`);
console.log(`Empty pages:            ${empty}`);
console.log(`Near-empty (<200 ch):   ${nearEmpty}`);
console.log(`Poor extraction:        ${poor}`);
console.log(`PDF pages in sample:    ${pdfs}`);

// Overall stats on entire website_pages
console.log('\n--- Overall stats (ALL website_pages) ---');
const all = db.prepare(`SELECT length(content) AS len FROM website_pages`).all();
const lens = all.map(r => r.len);
const avgAll = lens.reduce((a,b)=>a+b,0)/lens.length;
console.log(`Average: ${avgAll.toFixed(0)} chars`);
console.log(`Min:     ${Math.min(...lens)} chars`);
console.log(`Max:     ${Math.max(...lens)} chars`);
const empties = lens.filter(l => l === 0).length;
const near = lens.filter(l => l > 0 && l < 200).length;
console.log(`Empty:   ${empties}`);
console.log(`Near-empty (<200): ${near}`);

// Histogram of content lengths (all pages)
const buckets = [0, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 1000000];
const hist = {};
for (const b of buckets) hist[b] = 0;
for (const l of lens) {
  let placed = false;
  for (let i = 0; i < buckets.length - 1; i++) {
    if (l >= buckets[i] && l < buckets[i+1]) { hist[buckets[i]]++; placed = true; break; }
  }
  if (!placed) hist[buckets[buckets.length-1]]++;
}
console.log('\n--- Content-length histogram (ALL pages) ---');
for (const b of buckets) {
  const c = hist[b];
  console.log(`  ${b.toString().padStart(8)} - ${(b===buckets[buckets.length-1]?'+':buckets[buckets.indexOf(b)+1])} : ${c}`);
}

db.close();