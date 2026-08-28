const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function findDbFiles(dir, files_ = []) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (f === 'node_modules' || f === '.git' || f === 'dist') continue;
    const name = path.join(dir, f);
    if (fs.statSync(name).isDirectory()) {
      findDbFiles(name, files_);
    } else if (f.endsWith('.db')) {
      files_.push(name);
    }
  }
  return files_;
}

const root = path.resolve(__dirname, '..');
console.log('Searching for .db files in workspace:', root);
const dbFiles = findDbFiles(root);
console.log('Found .db files:', dbFiles);

for (const dbPath of dbFiles) {
  console.log(`\n========================================`);
  console.log(`DATABASE FILE: ${dbPath}`);
  console.log(`========================================`);
  try {
    const db = new Database(dbPath, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    console.log('Tables:', tables);
    if (tables.includes('crawl_jobs')) {
      const jobs = db.prepare("SELECT id, started_at, completed_at, pages_discovered, pages_crawled, pages_failed, status FROM crawl_jobs ORDER BY started_at DESC LIMIT 5").all();
      console.log('Recent crawl_jobs:', jobs);
    }
    if (tables.includes('crawl_job_urls')) {
      const urlStates = db.prepare("SELECT state, COUNT(*) as cnt FROM crawl_job_urls GROUP BY state").all();
      console.log('crawl_job_urls state breakdown:', urlStates);
    }
  } catch (e) {
    console.error('Could not read DB:', e.message);
  }
}
