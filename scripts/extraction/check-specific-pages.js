import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

console.log('=== CHECK SPECIFIC PAGES FOR FAILED QUESTIONS ===\n');

const criticalPages = [
  { q: 'Q5 (Admissions)', url: 'https://necn.ac.in/admission.php' },
  { q: 'Q5 (Admissions)', url: 'https://necn.ac.in/college-Fees.php' },
  { q: 'Q10 (Facilities)', url: 'https://necn.ac.in/facilites.php' },
  { q: 'Q11 (Placements)', url: 'https://necn.ac.in/placement-records.php' },
  { q: 'Q11 (Placements)', url: 'https://necn.ac.in/2023-24-placements.php' },
  { q: 'Q19 (Research)', url: 'https://necn.ac.in/research-activites.php' },
  { q: 'Q19 (Research)', url: 'https://necn.ac.in/Research-Policy.php' }
];

for (const page of criticalPages) {
  const pageData = db.prepare("SELECT id, url, title, is_active, content FROM website_pages WHERE url = ?").get(page.url);
  
  console.log(`${page.q}: ${page.url}`);
  if (pageData) {
    console.log(`  Status: ${pageData.is_active ? 'ACTIVE' : 'INACTIVE'}`);
    console.log(`  Title: ${pageData.title}`);
    console.log(`  Content length: ${pageData.content.length} chars`);
    console.log(`  Content preview: ${pageData.content.slice(0, 300)}...`);
    
    // Check chunks
    const chunks = db.prepare("SELECT id, embedding_json FROM website_chunks WHERE page_id = ?").all(pageData.id);
    console.log(`  Chunks: ${chunks.length}`);
    const embedded = chunks.filter(c => c.embedding_json).length;
    console.log(`  Embedded: ${embedded}/${chunks.length}`);
  } else {
    console.log('  NOT FOUND IN DATABASE');
  }
  console.log('');
}

db.close();
