import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

console.log('============================================================');
console.log('VERIFY UPDATED PAGES');
console.log('============================================================\n');

const pages = [
  'https://necn.ac.in/admission.php',
  'https://necn.ac.in/college-Fees.php',
  'https://necn.ac.in/facilites.php',
  'https://necn.ac.in/research-activites.php',
  'https://necn.ac.in/2023-24-placements.php'
];

for (const url of pages) {
  const page = db.prepare("SELECT title, content FROM website_pages WHERE url = ?").get(url) as any;
  if (page) {
    console.log(`${url}:`);
    console.log(`  Title: ${page.title}`);
    console.log(`  Content length: ${page.content.length} chars`);
    console.log(`  Preview: ${page.content.slice(0, 200)}...`);
    
    const chunks = db.prepare("SELECT COUNT(*) as count FROM website_chunks WHERE page_id = (SELECT id FROM website_pages WHERE url = ?)").get(url) as any;
    console.log(`  Chunks: ${chunks.count}`);
    console.log();
  } else {
    console.log(`${url}: NOT FOUND`);
    console.log();
  }
}

db.close();
