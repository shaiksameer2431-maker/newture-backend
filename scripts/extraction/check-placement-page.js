import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

console.log('=== CHECK PLACEMENT PAGE RETRIEVAL ===\n');

const placementUrl = 'https://necn.ac.in/2023-24-placements.php';

// Check if page exists
const page = db.prepare("SELECT id, url, title, is_active, content FROM website_pages WHERE url = ?").get(placementUrl);
console.log('Page exists:', !!page);
if (page) {
  console.log('Page ID:', page.id);
  console.log('Title:', page.title);
  console.log('Active:', page.is_active);
  console.log('Content length:', page.content.length);
}

// Check chunks
const chunks = db.prepare("SELECT id, content FROM website_chunks WHERE page_id = ?").all(page ? page.id : 'none');
console.log('\nChunks:', chunks.length);
for (const chunk of chunks) {
  console.log(`  Chunk ${chunk.id.slice(0, 8)}: ${chunk.content.slice(0, 200)}...`);
}

// Test if terms appear in content
if (page) {
  const terms = ['placement', 'statistics', 'company', 'salary', 'package', 'accenture', 'tcs', 'infosys'];
  console.log('\nTerm search in page content:');
  for (const term of terms) {
    const found = page.content.toLowerCase().includes(term);
    console.log(`  ${term}: ${found ? 'FOUND' : 'NOT FOUND'}`);
  }
}

// Test BM25 search for this specific page
console.log('\nBM25 search for "placement statistics":');
const searchResults = db.prepare(`
  SELECT c.id, c.content, p.url, p.title
  FROM website_chunks c
  JOIN website_pages p ON p.id = c.page_id
  WHERE LOWER(c.content) LIKE '%placement%'
  LIMIT 10
`).all();

console.log(`Found ${searchResults.length} chunks with 'placement':`);
for (const r of searchResults) {
  console.log(`  ${r.id.slice(0, 8)} ${r.url}`);
}

db.close();
