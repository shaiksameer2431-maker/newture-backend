import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

const pages = db.prepare("SELECT url FROM website_pages WHERE url LIKE '%fees%'").all();
console.log('Fees-related URLs:');
for (const page of pages) {
  console.log(`  ${page.url}`);
}

db.close();
