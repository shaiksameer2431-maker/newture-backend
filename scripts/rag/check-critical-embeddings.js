import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

console.log('=== CHECK EMBEDDINGS FOR CRITICAL PAGES ===\n');

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
  const pageData = db.prepare("SELECT id, url, title FROM website_pages WHERE url = ?").get(page.url);
  
  console.log(`${page.q}: ${page.url}`);
  if (pageData) {
    const chunks = db.prepare("SELECT id, content, embedding_json, embedding_model FROM website_chunks WHERE page_id = ?").all(pageData.id);
    console.log(`  Chunks: ${chunks.length}`);
    
    for (const chunk of chunks) {
      const hasEmbedding = chunk.embedding_json !== null;
      const embeddingModel = chunk.embedding_model || 'none';
      const embeddingDim = hasEmbedding ? JSON.parse(chunk.embedding_json).length : 0;
      
      console.log(`    Chunk ${chunk.id.slice(0, 8)}: embedding=${hasEmbedding} model=${embeddingModel} dim=${embeddingDim}`);
      console.log(`      Content preview: ${chunk.content.slice(0, 150)}...`);
    }
  } else {
    console.log('  NOT FOUND');
  }
  console.log('');
}

// Check chunks without embeddings
console.log('=== CHUNKS WITHOUT EMBEDDINGS ===');
const unembedded = db.prepare("SELECT c.id, c.content, p.url FROM website_chunks c JOIN website_pages p ON p.id = c.page_id WHERE c.embedding_json IS NULL LIMIT 10").all();
console.log(`Total unembedded chunks: ${unembedded.length}`);
for (const chunk of unembedded) {
  console.log(`  ${chunk.id.slice(0, 8)} from ${chunk.url}`);
  console.log(`    ${chunk.content.slice(0, 100)}...`);
}

db.close();
