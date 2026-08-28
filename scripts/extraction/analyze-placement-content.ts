import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

const placementUrl = 'https://necn.ac.in/2023-24-placements.php';

console.log('============================================================');
console.log('PLACEMENT PAGE CONTENT ANALYSIS');
console.log('============================================================\n');

// Get database content
const dbPage = db.prepare("SELECT content, title FROM website_pages WHERE url = ?").get(placementUrl) as any;

if (dbPage) {
  console.log('=== DATABASE CONTENT ===');
  console.log(`Title: ${dbPage.title}`);
  console.log(`Content length: ${dbPage.content.length} chars`);
  console.log(`Content preview (first 500 chars):`);
  console.log(dbPage.content.slice(0, 500));
  console.log();
  
  // Check for key terms
  const content = dbPage.content.toLowerCase();
  console.log('=== KEY TERM SEARCH IN DB CONTENT ===');
  console.log(`"placement": ${content.includes('placement') ? 'YES' : 'NO'}`);
  console.log(`"statistics": ${content.includes('statistics') ? 'YES' : 'NO'}`);
  console.log(`"company": ${content.includes('company') ? 'YES' : 'NO'}`);
  console.log(`"recruiting": ${content.includes('recruiting') ? 'YES' : 'NO'}`);
  console.log(`"accenture": ${content.includes('accenture') ? 'YES' : 'NO'}`);
  console.log(`"salary": ${content.includes('salary') ? 'YES' : 'NO'}`);
  console.log(`"lpa": ${content.includes('lpa') ? 'YES' : 'NO'}`);
  console.log();
} else {
  console.log('Placement page NOT FOUND in database');
}

// Get chunk content
const chunks = db.prepare("SELECT content, heading FROM website_chunks WHERE page_id = (SELECT id FROM website_pages WHERE url = ?) ORDER BY chunk_index").all(placementUrl) as any[];

console.log('=== CHUNKS ===');
console.log(`Number of chunks: ${chunks.length}`);
for (let i = 0; i < chunks.length; i++) {
  console.log(`Chunk ${i + 1}:`);
  console.log(`  Heading: ${chunks[i].heading}`);
  console.log(`  Content length: ${chunks[i].content.length} chars`);
  console.log(`  Preview: ${chunks[i].content.slice(0, 200)}...`);
  console.log();
}

// Compare with raw HTML
const htmlPath = path.join(__dirname, 'forensic-html', 'placement-stats.html');
const html = readFileSync(htmlPath, 'utf8');

console.log('=== RAW HTML ANALYSIS ===');
console.log(`Raw HTML size: ${html.length} bytes`);

// Count key terms in raw HTML
const htmlLower = html.toLowerCase();
console.log('=== KEY TERM SEARCH IN RAW HTML ===');
console.log(`"placement": ${htmlLower.includes('placement') ? 'YES' : 'NO'}`);
console.log(`"statistics": ${htmlLower.includes('statistics') ? 'YES' : 'NO'}`);
console.log(`"company": ${htmlLower.includes('company') ? 'YES' : 'NO'}`);
console.log(`"recruiting": ${htmlLower.includes('recruiting') ? 'YES' : 'NO'}`);
console.log(`"accenture": ${htmlLower.includes('accenture') ? 'YES' : 'NO'}`);
console.log(`"salary": ${htmlLower.includes('salary') ? 'YES' : 'NO'}`);
console.log(`"lpa": ${htmlLower.includes('lpa') ? 'YES' : 'NO'}`);

db.close();
