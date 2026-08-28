const db = require('better-sqlite3')('data/database.db');

console.log("=== SEARCHING ALL TABLES FOR '39bf' ===");
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
for (const t of tables) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
    for (const c of cols) {
      if (c.type === 'TEXT') {
        const rows = db.prepare(`SELECT * FROM ${t.name} WHERE ${c.name} LIKE '%39bf%'`).all();
        if (rows.length > 0) {
          console.log(`Found in table ${t.name}, column ${c.name}:`, rows);
        }
      }
    }
  } catch (e) {
    // skip virtual tables or errors
  }
}
