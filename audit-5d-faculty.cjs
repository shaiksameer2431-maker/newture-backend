const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve('./data/database.db');
const db = new Database(dbPath, { readonly: true });

const mech = db.prepare(`SELECT content FROM website_pages WHERE url = 'https://necn.ac.in/MECH/faculty.php'`).get();
console.log('Total length:', mech.content.length);
console.log('\n--- chars 4000-end ---');
console.log(mech.content.slice(4000));

console.log('\n--- Search any of: professor, head, incharge, dr., mr., mrs. ---');
const markers = ['professor','head','incharge','in-charge','in charge','dr.','mr.','mrs.','shri','smt'];
const lc = mech.content.toLowerCase();
for (const m of markers) {
  const i = lc.indexOf(m);
  console.log(`  "${m}" at ${i>=0 ? i : 'NOT FOUND'}`);
}

// Also confirm: do any other dept faculty pages have HOD?
console.log('\n========== HOD mentions in dept faculty pages ==========');
const facPages = db.prepare(`SELECT url, length(content) AS len FROM website_pages WHERE url LIKE '%/faculty.php'`).all();
for (const p of facPages) {
  const row = db.prepare(`SELECT content FROM website_pages WHERE url = ?`).get(p.url);
  const lc = (row.content||'').toLowerCase();
  const hodCount = (lc.match(/hod/g) || []).length;
  const profCount = (lc.match(/professor/g) || []).length;
  const headCount = (lc.match(/head/g) || []).length;
  console.log(`  ${p.url} | HOD=${hodCount} Professor=${profCount} Head=${headCount} | ${p.len} chars`);
}
