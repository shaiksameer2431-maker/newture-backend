// AUDIT 3: module coverage + show actual page content samples
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve('./data/database.db');
const db = new Database(dbPath, { readonly: true });

console.log('========== MODULE COVERAGE ==========\n');

// Group URLs by top-level section
const sections = db.prepare(`
  SELECT
    CASE
      WHEN url LIKE '%/admission%' OR url LIKE '%Admission%' THEN 'admissions'
      WHEN url LIKE '%/academics%' OR url LIKE '%Academics%' OR url LIKE '%syllabus%' OR url LIKE '%curriculum%' THEN 'academics'
      WHEN url LIKE '%/department%' OR url LIKE '%/Department%' THEN 'departments'
      WHEN url LIKE '%/faculty%' OR url LIKE '%Faculty%' THEN 'faculty'
      WHEN url LIKE '%/placement%' OR url LIKE '%Placement%' THEN 'placements'
      WHEN url LIKE '%/facilities%' OR url LIKE '%Facilities%' OR url LIKE '%library%' OR url LIKE '%hostel%' THEN 'facilities'
      WHEN url LIKE '%/research%' OR url LIKE '%Research%' THEN 'research'
      WHEN url LIKE '%/notice%' OR url LIKE '%Notice%' OR url LIKE '%news%' OR url LIKE '%News%' THEN 'notices'
      WHEN url LIKE '%/event%' OR url LIKE '%Event%' OR url LIKE '%gallery%' OR url LIKE '%Gallery%' THEN 'events'
      WHEN url LIKE '%/NCC%' OR url LIKE '%ncc%' THEN 'NCC'
      WHEN url LIKE '%/sport%' OR url LIKE '%Sport%' OR url LIKE '%games%' THEN 'sports'
      WHEN url LIKE '%/regulation%' OR url LIKE '%Regulation%' THEN 'regulations'
      WHEN url LIKE '%calendar%' OR url LIKE '%Calendar%' THEN 'academic_calendars'
      WHEN url LIKE '%.pdf' OR url LIKE '%/pdf%' OR (content_type LIKE '%pdf%') THEN 'PDFs'
      ELSE 'other'
    END AS section,
    COUNT(*) AS c
  FROM website_pages
  GROUP BY section
  ORDER BY c DESC
`).all();
for (const r of sections) console.log(`${r.section.padEnd(20)} ${r.c}`);

// Distinct department directories present (based on URL path prefix)
console.log('\n--- Distinct department prefixes (path segment after host) ---');
const depts = db.prepare(`
  SELECT
    CASE
      WHEN instr(url, 'necn.ac.in/') > 0
      THEN substr(url, instr(url, 'necn.ac.in/') + length('necn.ac.in/'),
                  CASE WHEN instr(substr(url, instr(url, 'necn.ac.in/') + length('necn.ac.in/')), '/') > 0
                       THEN instr(substr(url, instr(url, 'necn.ac.in/') + length('necn.ac.in/')), '/') - 1
                       ELSE length(url) END)
      ELSE url
    END AS top,
    COUNT(*) AS c
  FROM website_pages
  GROUP BY top
  ORDER BY c DESC
`).all();
for (const d of depts) console.log(`${(d.top||'(root)').padEnd(40)} ${d.c}`);

// Sample URLs per category
console.log('\n--- Admissions sample URLs ---');
const ad = db.prepare(`SELECT url, title FROM website_pages WHERE url LIKE '%admission%' OR url LIKE '%Admission%' LIMIT 10`).all();
for (const r of ad) console.log(`  ${r.url} | ${r.title}`);

console.log('\n--- Facilities sample URLs ---');
const fa = db.prepare(`SELECT url, title FROM website_pages WHERE url LIKE '%facilities%' OR url LIKE '%library%' OR url LIKE '%hostel%' LIMIT 10`).all();
for (const r of fa) console.log(`  ${r.url} | ${r.title}`);

console.log('\n--- Placements sample URLs ---');
const pl = db.prepare(`SELECT url, title FROM website_pages WHERE url LIKE '%placement%' OR url LIKE '%Placement%' LIMIT 10`).all();
for (const r of pl) console.log(`  ${r.url} | ${r.title}`);

console.log('\n--- PDFs sample URLs ---');
const pdfs = db.prepare(`SELECT url, title, length(content) AS len FROM website_pages WHERE url LIKE '%.pdf' OR (content_type LIKE '%pdf%') LIMIT 20`).all();
for (const r of pdfs) console.log(`  ${r.url} | ${r.len} chars | ${(r.title||'').slice(0,40)}`);

console.log('\n--- Notices / News sample URLs ---');
const nt = db.prepare(`SELECT url, title FROM website_pages WHERE url LIKE '%notice%' OR url LIKE '%Notice%' OR url LIKE '%news%' OR url LIKE '%News%' LIMIT 10`).all();
for (const r of nt) console.log(`  ${r.url} | ${r.title}`);

console.log('\n--- Calendar / Regulation sample URLs ---');
const cr = db.prepare(`SELECT url, title FROM website_pages WHERE url LIKE '%calendar%' OR url LIKE '%regulation%' LIMIT 10`).all();
for (const r of cr) console.log(`  ${r.url} | ${r.title}`);

console.log('\n--- NCC / Sports sample URLs ---');
const ns = db.prepare(`SELECT url, title FROM website_pages WHERE url LIKE '%NCC%' OR url LIKE '%ncc%' OR url LIKE '%sport%' OR url LIKE '%game%' LIMIT 10`).all();
for (const r of ns) console.log(`  ${r.url} | ${r.title}`);

console.log('\n--- Research / Events sample URLs ---');
const re = db.prepare(`SELECT url, title FROM website_pages WHERE url LIKE '%research%' OR url LIKE '%event%' OR url LIKE '%gallery%' LIMIT 10`).all();
for (const r of re) console.log(`  ${r.url} | ${r.title}`);

// Title distribution — count how many pages have generic vs specific title
console.log('\n--- Title distribution ---');
const titles = db.prepare(`
  SELECT title, COUNT(*) AS c
  FROM website_pages
  GROUP BY title
  ORDER BY c DESC
  LIMIT 20
`).all();
for (const t of titles) console.log(`${c.toString ? '' : ''}${(t.title||'(null)').padEnd(60)} ${t.c}`);

db.close();