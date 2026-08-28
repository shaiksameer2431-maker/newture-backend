import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

console.log('=== TEST RETRIEVAL FOR FAILED QUESTIONS ===\n');

const queries = [
  { q: 'Q5', query: 'What is the admission procedure and eligibility criteria for B.Tech?' },
  { q: 'Q6', query: 'What details are available about college fees and admission requirements?' },
  { q: 'Q10', query: 'What campus infrastructure, hostel, and canteen facilities exist?' },
  { q: 'Q11', query: 'What are the placement statistics and top recruiting companies at NECN?' },
  { q: 'Q19', query: 'What research and development activities take place at NECN?' }
];

for (const test of queries) {
  console.log(`=== ${test.q}: ${test.query} ===`);
  
  // FTS5 search
  const ftsResults = db.prepare(`
    SELECT c.id, c.content, p.url, p.title, bm25(website_chunks_fts) as score
    FROM website_chunks_fts fts
    JOIN website_chunks c ON c.id = fts.rowid
    JOIN website_pages p ON p.id = c.page_id
    WHERE website_chunks_fts MATCH ?
    ORDER BY score
    LIMIT 5
  `).all(test.query);
  
  console.log(`FTS5 Results (${ftsResults.length}):`);
  for (const r of ftsResults) {
    console.log(`  ${r.id.slice(0, 8)} score=${r.score} ${r.url}`);
    console.log(`    ${r.content.slice(0, 150)}...`);
  }
  
  console.log('');
}

db.close();
