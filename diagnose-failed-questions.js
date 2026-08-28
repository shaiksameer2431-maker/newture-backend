import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

console.log('=== DATABASE CONTENT CHECK FOR FAILED QUESTIONS ===\n');

const failedQuestions = [
  { id: 5, query: 'What is the admission procedure and eligibility criteria for B.Tech?' },
  { id: 6, query: 'What details are available about college fees and admission requirements?' },
  { id: 10, query: 'What campus infrastructure, hostel, and canteen facilities exist?' },
  { id: 11, query: 'What are the placement statistics and top recruiting companies at NECN?' },
  { id: 19, query: 'What research and development activities take place at NECN?' }
];

for (const q of failedQuestions) {
  console.log(`Q${q.id}: ${q.query}`);
  console.log('---');
  
  // Search website_pages for relevant content
  const searchTerms = q.query.split(' ').filter(w => w.length > 3).slice(0, 3);
  for (const term of searchTerms) {
    const pages = db.prepare("SELECT url, title, content FROM website_pages WHERE content LIKE ? LIMIT 3").all(`%${term}%`);
    if (pages.length > 0) {
      console.log(`  Pages containing "${term}":`);
      for (const page of pages) {
        console.log(`    - ${page.url}`);
        console.log(`      Title: ${page.title}`);
        console.log(`      Content preview: ${page.content.slice(0, 200)}...`);
      }
    }
  }
  
  // Search website_chunks for relevant content
  for (const term of searchTerms) {
    const chunks = db.prepare("SELECT c.id, c.page_id, c.content, p.url, p.title FROM website_chunks c JOIN website_pages p ON p.id = c.page_id WHERE c.content LIKE ? LIMIT 3").all(`%${term}%`);
    if (chunks.length > 0) {
      console.log(`  Chunks containing "${term}":`);
      for (const chunk of chunks) {
        console.log(`    - Chunk ${chunk.id.slice(0, 8)} from ${chunk.url}`);
        console.log(`      Content preview: ${chunk.content.slice(0, 200)}...`);
      }
    }
  }
  
  console.log('');
}

db.close();
