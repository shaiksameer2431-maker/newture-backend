import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

console.log('=== EXTRACT FULL CONTENT FROM RELEVANT PAGES ===\n');

const pagesToCheck = [
  { name: 'facilites.php', url: 'https://necn.ac.in/facilites.php' },
  { name: 'placement-records.php', url: 'https://necn.ac.in/placement-records.php' },
  { name: '2023-24-placements.php', url: 'https://necn.ac.in/2023-24-placements.php' },
  { name: 'Research-Policy.php', url: 'https://necn.ac.in/Research-Policy.php' }
];

for (const page of pagesToCheck) {
  const pageData = db.prepare("SELECT content FROM website_pages WHERE url = ?").get(page.url);
  
  console.log(`=== ${page.name} ===`);
  if (pageData) {
    console.log(pageData.content);
  } else {
    console.log('NOT FOUND');
  }
  console.log('\n' + '='.repeat(80) + '\n');
}

db.close();
