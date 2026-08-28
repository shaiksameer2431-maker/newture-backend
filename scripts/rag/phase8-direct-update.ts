import { cleanPageContent } from './src/services/contentCleaner.js';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { chunkStructuredText } from './src/services/chunker.js';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

const PAGES_TO_UPDATE = [
  'https://necn.ac.in/admission.php',
  'https://necn.ac.in/college-Fees.php',
  'https://necn.ac.in/facilites.php',
  'https://necn.ac.in/research-activites.php',
  'https://necn.ac.in/Research-Policy.php',
  'https://necn.ac.in/2023-24-placements.php'
];

console.log('============================================================');
console.log('PHASE 8: DIRECT CONTENT UPDATE FOR AFFECTED PAGES');
console.log('============================================================\n');

for (const url of PAGES_TO_UPDATE) {
  console.log(`Processing: ${url}`);
  
  // Get raw HTML from forensic file
  let pageName = url.split('/').pop().replace('.php', '');
  // Map special cases to forensic file names (from phase1)
  const forensicNames: Record<string, string> = {
    'college-Fees': 'college-fees',
    '2023-24-placements': 'placement-stats',
    'facilites': 'facilities',
    'research-activites': 'research-activities'
  };
  pageName = forensicNames[pageName] || pageName;
  const htmlPath = path.join(__dirname, 'forensic-html', `${pageName}.html`);
  
  try {
    const html = readFileSync(htmlPath, 'utf8');
    
    // Clean content with improved cleaner
    const cleanedContent = cleanPageContent(html, { source: 'crawler' });
    
    console.log(`  Raw HTML: ${html.length} bytes`);
    console.log(`  Cleaned content: ${cleanedContent.length} chars`);
    
    if (cleanedContent.length < 100) {
      console.log(`  WARNING: Cleaned content too short, skipping update`);
      continue;
    }
    
    // Get existing page
    const existingPage = db.prepare("SELECT id, content_hash FROM website_pages WHERE url = ?").get(url) as any;
    
    if (!existingPage) {
      console.log(`  ERROR: Page not found in database`);
      continue;
    }
    
    // Create hash
    const hash = crypto.createHash('sha256').update(cleanedContent).digest('hex');
    
    // Check if content changed (commented out to force re-chunking)
    /*
    if (existingPage.content_hash === hash) {
      console.log(`  Content unchanged, skipping`);
      continue;
    }
    */
    
    console.log(`  Content changed, updating database`);
    
    // Update page content
    const title = cleanedContent.split('\n')[0].replace(/^##H[1-6]##\s*/, '').trim() || pageName;
    const category = url.includes('admission') ? 'Admissions' : 
                    url.includes('facilit') ? 'Campus Life' :
                    url.includes('research') ? 'Research' :
                    url.includes('placement') ? 'Placements' : 'General';
    
    db.prepare(`
      UPDATE website_pages 
      SET content = ?, title = ?, category = ?, content_hash = ?, 
          last_changed = ?, clean_content_hash = ?
      WHERE url = ?
    `).run(cleanedContent, title, category, hash, new Date().toISOString(), hash, url);
    
    // Delete old chunks
    db.prepare("DELETE FROM website_chunks WHERE page_id = ?").run(existingPage.id);
    
    // Create new chunks
    const chunks = chunkStructuredText(cleanedContent);
    const insertChunk = db.prepare(`INSERT INTO website_chunks (id,page_id,heading,content,chunk_index,keywords,section,department,start_offset,end_offset,chunk_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    
    for (const chunk of chunks) {
      const chunkHash = crypto.createHash('sha256').update(chunk.content).digest('hex').slice(0, 16);
      const keywords = generateKeywords(`${title} ${chunk.content}`);
      
      insertChunk.run(
        crypto.randomUUID(),
        existingPage.id,
        chunk.heading,
        chunk.content,
        chunk.index,
        keywords,
        category,
        null,
        (chunk as any).startOffset ?? null,
        (chunk as any).endOffset ?? null,
        chunkHash,
        new Date().toISOString()
      );
    }
    
    console.log(`  Updated with ${chunks.length} chunks`);
    
  } catch (error) {
    console.log(`  ERROR: ${error.message}`);
  }
  
  console.log();
}

db.close();

console.log('============================================================');
console.log('DIRECT UPDATE COMPLETE');
console.log('============================================================');

function generateKeywords(content: string): string {
  const stop = new Set([
    'the','and','for','with','from','that','this','are','was','were','has','have','will','into','your','their','about',
    'college','engineering','department','professor','assistant','associate'
  ]);
  const counts = new Map<string, number>();
  for (const token of content.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []) {
    if (stop.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([k]) => k).join(',');
}
