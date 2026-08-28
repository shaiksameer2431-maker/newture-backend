import { cleanPageContent } from './src/services/contentCleaner.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('============================================================');
console.log('TEST CONTENT CLEANER ON RAW HTML');
console.log('============================================================\n');

const pages = ['admission', 'research-activities', 'facilities'];

for (const page of pages) {
  console.log(`=== ${page.toUpperCase()} ===`);
  const htmlPath = path.join(__dirname, 'forensic-html', `${page}.html`);
  const html = readFileSync(htmlPath, 'utf8');
  
  const cleaned = cleanPageContent(html, { source: 'crawler' });
  
  console.log(`Raw HTML size: ${html.length} bytes`);
  console.log(`Cleaned content size: ${cleaned.length} chars`);
  console.log(`Cleaned content preview (first 300 chars):`);
  console.log(cleaned.slice(0, 300));
  console.log();
}
