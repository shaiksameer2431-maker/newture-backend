import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

const PAGES_TO_COMPARE = [
  { name: 'admission', url: 'https://necn.ac.in/admission.php' },
  { name: 'college-fees', url: 'https://necn.ac.in/college-fees.php' },
  { name: 'facilities', url: 'https://necn.ac.in/facilites.php' },
  { name: 'research-activities', url: 'https://necn.ac.in/research-activites.php' },
  { name: 'research-policy', url: 'https://necn.ac.in/Research-Policy.php' },
  { name: 'placement-stats', url: 'https://necn.ac.in/2023-24-placements.php' }
];

console.log('============================================================');
console.log('PHASE 2: COMPARE RAW HTML VS CRAWLER EXTRACTION');
console.log('============================================================\n');

for (const page of PAGES_TO_COMPARE) {
  console.log(`=== ${page.name.toUpperCase()} ===`);
  
  // Get raw HTML from forensic file
  const htmlPath = path.join(__dirname, 'forensic-html', `${page.name}.html`);
  let htmlSize = 0;
  let htmlVisibleText = 0;
  try {
    const html = readFileSync(htmlPath, 'utf8');
    htmlSize = html.length;
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : html;
    const visibleText = bodyContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    htmlVisibleText = visibleText.length;
  } catch (e) {
    console.log(`  Raw HTML: NOT FOUND`);
  }
  
  // Get database content
  const dbPage = db.prepare("SELECT content, title FROM website_pages WHERE url = ?").get(page.url) as any;
  
  if (dbPage) {
    console.log(`  Database content length: ${dbPage.content.length} chars`);
    console.log(`  Database title: ${dbPage.title}`);
    
    // Calculate content ratio
    const ratio = dbPage.content.length / htmlVisibleText;
    console.log(`  Content ratio (DB/Raw): ${(ratio * 100).toFixed(1)}%`);
    
    // Check if content is navigation-only
    const isNavOnly = dbPage.content.length < 500 && 
                     (dbPage.content.includes('About Us') || 
                      dbPage.content.includes('Vision and Mission') ||
                      dbPage.content.includes('NEC Nellore'));
    console.log(`  Is navigation-only: ${isNavOnly ? 'YES' : 'NO'}`);
    
    // Show first 200 chars of DB content
    console.log(`  DB content preview: ${dbPage.content.slice(0, 200)}...`);
    
    // Get chunks
    const chunks = db.prepare("SELECT COUNT(*) as count FROM website_chunks WHERE page_id = (SELECT id FROM website_pages WHERE url = ?)").get(page.url) as any;
    console.log(`  Number of chunks: ${chunks.count}`);
    
    // Get first chunk content
    const firstChunk = db.prepare("SELECT content FROM website_chunks WHERE page_id = (SELECT id FROM website_pages WHERE url = ?) ORDER BY chunk_index LIMIT 1").get(page.url) as any;
    if (firstChunk) {
      console.log(`  First chunk preview: ${firstChunk.content.slice(0, 200)}...`);
    }
  } else {
    console.log(`  Database: NOT FOUND`);
  }
  
  console.log(`  Raw HTML size: ${htmlSize} bytes`);
  console.log(`  Raw visible text: ${htmlVisibleText} chars`);
  console.log();
}

db.close();
