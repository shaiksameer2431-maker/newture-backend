const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve('./data/database.db');
const db = new Database(dbPath, { readonly: true });

const mech = db.prepare(`SELECT content FROM website_pages WHERE url = 'https://necn.ac.in/MECH/faculty.php'`).get();
console.log('--- MECH/faculty.php content (chars 1500-4000) ---');
console.log(mech.content.slice(1500, 4000));

console.log('\n--- Look for HOD or Professor & HOD ---');
const lc = mech.content.toLowerCase();
let idx = -1;
while ((idx = lc.indexOf('hod', idx+1)) !== -1) {
  console.log(`[${idx}] ...${mech.content.slice(Math.max(0,idx-150), idx+250)}...`);
}
