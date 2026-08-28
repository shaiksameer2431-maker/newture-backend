import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

console.log('=== LIST ALL CHUNKS FOR PLACEMENT PAGE ===\n');

const placementUrl = 'https://necn.ac.in/2023-24-placements.php';

const page = db.prepare("SELECT id FROM website_pages WHERE url = ?").get(placementUrl);
if (page) {
  const chunks = db.prepare("SELECT id, content FROM website_chunks WHERE page_id = ?").all(page.id);
  console.log(`Found ${chunks.length} chunks for placement page:`);
  
  for (const chunk of chunks) {
    console.log(`\nChunk ID: ${chunk.id}`);
    console.log(`Content length: ${chunk.content.length}`);
    console.log(`Content preview: ${chunk.content.slice(0, 500)}...`);
    
    // Check for key terms
    const hasAccenture = chunk.content.toLowerCase().includes('accenture');
    const hasSalary = chunk.content.toLowerCase().includes('salary');
    const hasTable = chunk.content.includes('|') || chunk.content.includes('LPA');
    
    console.log(`Contains "accenture": ${hasAccenture}`);
    console.log(`Contains "salary": ${hasSalary}`);
    console.log(`Contains table data: ${hasTable}`);
  }
} else {
  console.log('Page not found');
}

db.close();
