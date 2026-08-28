const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve('./data/database.db');
const db = new Database(dbPath, { readonly: true });

console.log('--- Static dept tables ---');
for (const t of ['departments','faculty','rules','notices','portal_links']) {
  const c = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get();
  console.log(`${t}: ${c.c}`);
}

console.log('\n--- Sample rules (if any) ---');
const rules = db.prepare(`SELECT id, category, substr(question,1,80) AS q FROM rules LIMIT 10`).all();
for (const r of rules) console.log(`  [${r.category}] ${r.q}`);

console.log('\n--- departments rows ---');
const depts = db.prepare(`SELECT * FROM departments LIMIT 20`).all();
for (const d of depts) console.log(JSON.stringify(d));

console.log('\n--- faculty rows ---');
const fac = db.prepare(`SELECT * FROM faculty LIMIT 20`).all();
for (const f of fac) console.log(JSON.stringify(f));
