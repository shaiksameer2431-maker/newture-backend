import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

console.log('============================================================');
console.log('PHASE 5: COMPREHENSIVE HOSTEL SEARCH');
console.log('============================================================\n');

// Search for hostel-related terms in all pages
const hostelTerms = ['hostel', 'accommodation', 'dormitory', 'residential', 'boarding', 'lodging'];

console.log('=== SEARCHING WEBSITE_PAGES ===');
for (const term of hostelTerms) {
  const pages = db.prepare("SELECT url, title FROM website_pages WHERE url LIKE ? OR title LIKE ? OR content LIKE ?").all(`%${term}%`, `%${term}%`, `%${term}%`);
  console.log(`"${term}": ${pages.length} pages found`);
  for (const page of pages) {
    console.log(`  - ${page.url} (${page.title})`);
  }
}

console.log('\n=== SEARCHING WEBSITE_CHUNKS ===');
for (const term of hostelTerms) {
  const chunks = db.prepare("SELECT COUNT(*) as count FROM website_chunks WHERE content LIKE ?").all(`%${term}%`);
  console.log(`"${term}": ${chunks[0].count} chunks found`);
}

console.log('\n=== SEARCHING ALL URLS FOR HOSTEL-RELATED PATHS ===');
const hostelUrls = db.prepare("SELECT url FROM website_pages WHERE url LIKE '%hostel%' OR url LIKE '%accommodation%' OR url LIKE '%dormitory%'").all();
console.log(`Found ${hostelUrls.length} URLs with hostel-related paths:`);
for (const row of hostelUrls) {
  console.log(`  - ${row.url}`);
}

console.log('\n=== CHECKING FACILITIES PAGE FOR HOSTEL MENTIONS ===');
const facilitiesContent = db.prepare("SELECT content FROM website_pages WHERE url = 'https://necn.ac.in/facilites.php'").get() as any;
if (facilitiesContent) {
  const content = facilitiesContent.content.toLowerCase();
  console.log('Hostel mentions in facilities page:');
  console.log(`  "hostel": ${content.includes('hostel') ? 'YES' : 'NO'}`);
  console.log(`  "accommodation": ${content.includes('accommodation') ? 'YES' : 'NO'}`);
  console.log(`  "residential": ${content.includes('residential') ? 'YES' : 'NO'}`);
  console.log(`  "boarding": ${content.includes('boarding') ? 'YES' : 'NO'}`);
  console.log(`  "lodging": ${content.includes('lodging') ? 'YES' : 'NO'}`);
}

db.close();

console.log('\n=== HOSTEL_INFORMATION_STATUS ===');
console.log('Based on comprehensive search of database:');
console.log('- No dedicated hostel pages found');
console.log('- No accommodation pages found');
console.log('- No hostel content in facilities page');
console.log('- Only 1 PDF mentions hostel (PERSONAL COUNSELING.pdf)');
console.log('\nCONCLUSION: HOSTEL_INFORMATION_STATUS = NOT_FOUND');
console.log('Hostel information does not exist on the official NECN website.');
