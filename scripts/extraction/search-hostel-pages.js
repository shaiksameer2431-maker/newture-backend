import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

console.log('=== SEARCH FOR HOSTEL PAGES ===\n');

// Search for hostel-related pages
const hostelPages = db.prepare("SELECT url, title, content FROM website_pages WHERE url LIKE '%hostel%' OR title LIKE '%hostel%' OR content LIKE '%hostel%'").all();

console.log(`Found ${hostelPages.length} pages with 'hostel':`);
for (const page of hostelPages) {
  console.log(`  - ${page.url} (${page.title})`);
  console.log(`    Content preview: ${page.content.slice(0, 200)}...`);
}

// Also search for accommodation-related terms
const accommPages = db.prepare("SELECT url, title FROM website_pages WHERE url LIKE '%accommodation%' OR title LIKE '%accommodation%'").all();

console.log(`\nFound ${accommPages.length} pages with 'accommodation':`);
for (const page of accommPages) {
  console.log(`  - ${page.url} (${page.title})`);
}

db.close();
