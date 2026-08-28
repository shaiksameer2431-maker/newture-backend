import { cleanPageContent } from './src/services/contentCleaner.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('============================================================');
console.log('TEST SELECTIVE CONTENT EXTRACTION');
console.log('============================================================\n');

const pages = ['admission', 'research-activities'];

for (const page of pages) {
  console.log(`=== ${page.toUpperCase()} ===`);
  const htmlPath = path.join(__dirname, 'forensic-html', `${page}.html`);
  const html = readFileSync(htmlPath, 'utf8');
  
  // Try to extract page-content div specifically
  const pageContentMatch = html.match(/<div[^>]*class="[^"]*page-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  
  if (pageContentMatch) {
    const pageContent = pageContentMatch[1];
    console.log(`Found page-content div: ${pageContent.length} chars`);
    console.log(`Preview: ${pageContent.slice(0, 300)}...`);
    
    // Clean this specific content
    const cleaned = cleanPageContent(pageContent, { source: 'crawler' });
    console.log(`After cleaning: ${cleaned.length} chars`);
    console.log(`Cleaned preview: ${cleaned.slice(0, 300)}...`);
  } else {
    console.log(`page-content div NOT FOUND`);
  }
  
  console.log();
}
