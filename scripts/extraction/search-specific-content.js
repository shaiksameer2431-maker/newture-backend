import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

console.log('=== TARGETED CONTENT SEARCH ===\n');

// Search for specific content areas
const searches = [
  { name: 'Admissions', terms: ['admission', 'eligibility', 'criteria', 'procedure', 'fee', 'tuition'] },
  { name: 'Facilities', terms: ['hostel', 'canteen', 'infrastructure', 'campus', 'building', 'laboratory'] },
  { name: 'Placements', terms: ['placement', 'recruiting', 'company', 'salary', 'package', 'job', 'selected'] },
  { name: 'Research', terms: ['research', 'development', 'R&D', 'innovation', 'project', 'publication'] }
];

for (const search of searches) {
  console.log(`=== ${search.name.toUpperCase()} ===`);
  
  for (const term of search.terms) {
    const pages = db.prepare("SELECT url, title FROM website_pages WHERE content LIKE ? LIMIT 5").all(`%${term}%`);
    if (pages.length > 0) {
      console.log(`\nPages with "${term}":`);
      for (const page of pages) {
        console.log(`  - ${page.url} (${page.title})`);
      }
    }
  }
  
  console.log('');
}

// Check for specific department pages that might have this info
console.log('=== SPECIFIC PAGE TYPES ===');
const pageTypes = db.prepare("SELECT DISTINCT SUBSTR(url, 1, INSTR(url, '/') - 1) as type FROM website_pages WHERE url LIKE '%/%' ORDER BY type").all();
console.log('Page types found:', pageTypes.map(p => p.type).join(', '));

// Check for admissions-related URLs
console.log('\n=== ADMISSIONS-RELATED URLs ===');
const admissionUrls = db.prepare("SELECT url, title FROM website_pages WHERE url LIKE '%admission%' OR url LIKE '%fee%' OR title LIKE '%admission%' OR title LIKE '%fee%'").all();
for (const url of admissionUrls) {
  console.log(`  - ${url.url} (${url.title})`);
}

// Check for placement-related URLs
console.log('\n=== PLACEMENT-RELATED URLs ===');
const placementUrls = db.prepare("SELECT url, title FROM website_pages WHERE url LIKE '%placement%' OR title LIKE '%placement%'").all();
for (const url of placementUrls) {
  console.log(`  - ${url.url} (${url.title})`);
}

// Check for research-related URLs
console.log('\n=== RESEARCH-RELATED URLs ===');
const researchUrls = db.prepare("SELECT url, title FROM website_pages WHERE url LIKE '%research%' OR url LIKE '%rd%' OR title LIKE '%research%'").all();
for (const url of researchUrls) {
  console.log(`  - ${url.url} (${url.title})`);
}

db.close();
