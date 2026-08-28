import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

console.log('=== TEST BM25 RETRIEVAL FOR FAILED QUESTIONS ===\n');

const queries = [
  { q: 'Q5', query: 'What is the admission procedure and eligibility criteria for B.Tech?' },
  { q: 'Q6', query: 'What details are available about college fees and admission requirements?' },
  { q: 'Q10', query: 'What campus infrastructure, hostel, and canteen facilities exist?' },
  { q: 'Q11', query: 'What are the placement statistics and top recruiting companies at NECN?' },
  { q: 'Q19', query: 'What research and development activities take place at NECN?' }
];

// Simple BM25-like keyword search
function simpleSearch(query, limit = 5) {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3);
  const scores = new Map();
  
  for (const term of terms) {
    const results = db.prepare(`
      SELECT c.id, c.content, p.url, p.title
      FROM website_chunks c
      JOIN website_pages p ON p.id = c.page_id
      WHERE LOWER(c.content) LIKE ?
    `).all(`%${term}%`);
    
    for (const r of results) {
      const current = scores.get(r.id) || { count: 0, data: r };
      current.count++;
      scores.set(r.id, current);
    }
  }
  
  // Sort by term match count
  const sorted = Array.from(scores.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(s => ({ ...s.data, score: s.count }));
  
  return sorted;
}

for (const test of queries) {
  console.log(`=== ${test.q}: ${test.query} ===`);
  
  const results = simpleSearch(test.query, 5);
  
  console.log(`BM25 Results (${results.length}):`);
  for (const r of results) {
    console.log(`  ${r.id.slice(0, 8)} score=${r.score} ${r.url}`);
    console.log(`    ${r.content.slice(0, 150)}...`);
  }
  
  console.log('');
}

db.close();
