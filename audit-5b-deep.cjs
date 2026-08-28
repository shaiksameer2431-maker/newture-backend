// AUDIT 5b: deeper checks for HODs and PDFs in retrieval
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve('./data/database.db');
const db = new Database(dbPath, { readonly: true });

// Is there ANY page with HOD for mechanical?
console.log('========== MECHANICAL HOD SEARCH ==========');
const mechHod = db.prepare(`SELECT url, title, length(content) AS len FROM website_pages WHERE url LIKE '%MECH%' AND lower(content) LIKE '%hod%' LIMIT 10`).all();
for (const r of mechHod) console.log(`  ${r.url} (${r.len} chars)`);

if (mechHod.length) {
  const one = db.prepare(`SELECT content FROM website_pages WHERE url = ?`).get(mechHod[0].url);
  console.log('First HOD-mention snippet:');
  const idx = one.content.toLowerCase().indexOf('hod');
  console.log(one.content.slice(Math.max(0, idx-100), idx + 500));
}

console.log('\n========== CAREER COUNSELING (PDF) REACHABILITY ==========');
const cc = db.prepare(`SELECT url, title, length(content) AS len FROM website_pages WHERE title LIKE '%CAREER COUNSELING%' OR title LIKE '%Career Counseling%' OR url LIKE '%CAREER%COUNSELING%'`).all();
for (const r of cc) console.log(`  ${r.url} title='${r.title}' ${r.len} chars`);

if (cc.length) {
  const one = db.prepare(`SELECT content FROM website_pages WHERE id = (SELECT id FROM website_pages WHERE url = ?)`).get(cc[0].url);
  console.log('First 2000 chars of PDF-extracted content:');
  console.log(one.content.slice(0, 2000));
}

const pc = db.prepare(`SELECT url, title, length(content) AS len FROM website_pages WHERE title LIKE '%PERSONAL COUNSELING%'`).all();
console.log('\n--- PERSONAL COUNSELING ---');
for (const r of pc) console.log(`  ${r.url} title='${r.title}' ${r.len} chars`);

// Are PDF pages chunked?
console.log('\n========== CHUNKS FOR PDF PAGES ==========');
const pdfPages = db.prepare(`SELECT id, url FROM website_pages WHERE (url LIKE '%.pdf') AND is_active = 1`).all();
for (const p of pdfPages) {
  const cnt = db.prepare(`SELECT COUNT(*) AS c FROM website_chunks WHERE page_id = ?`).get(p.id);
  console.log(`  ${p.url}: ${cnt.c} chunks`);
}

// admissions URL existence
console.log('\n========== ADMISSIONS URL EXISTENCE ==========');
const adm = db.prepare(`SELECT id, url, length(content) AS len FROM website_pages WHERE url LIKE '%admission%' OR url LIKE '%Admission%' ORDER BY url`).all();
for (const r of adm) console.log(`  ${r.url} (${r.len} chars)`);

// What about principal / director?
console.log('\n========== PRINCIPAL / DIRECTOR PAGES ==========');
const pd = db.prepare(`SELECT url, title FROM website_pages WHERE url LIKE '%principal%' OR url LIKE '%director%' LIMIT 20`).all();
for (const r of pd) console.log(`  ${r.url} | ${r.title}`);

console.log('\n========== FACULTY-HOD CONTENT PRESENCE ==========');
const mechPage = db.prepare(`SELECT url, length(content) AS len FROM website_pages WHERE url LIKE '%MECH%faculty%'`).all();
for (const r of mechPage) console.log(`  ${r.url} (${r.len} chars)`);

db.close();
