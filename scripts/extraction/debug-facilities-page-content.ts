import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('=== DEBUG FACILITIES PAGE-CONTENT EXTRACTION ===\n');

const htmlPath = path.join(__dirname, 'forensic-html', 'facilities.html');
const html = readFileSync(htmlPath, 'utf8');

// Test the page-content extraction
const pageContentMatch = html.match(/<div[^>]*class="[^"]*page-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

if (pageContentMatch) {
  console.log('Found page-content div!');
  console.log(`Length: ${pageContentMatch[1].length} chars`);
  console.log(`Preview: ${pageContentMatch[1].slice(0, 500)}...`);
} else {
  console.log('page-content div NOT FOUND');
  
  // Try to find it with a simpler pattern
  const simpleMatch = html.match(/page-content/);
  if (simpleMatch) {
    console.log('Found "page-content" string in HTML');
    // Find the line
    const lines = html.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('page-content')) {
        console.log(`Line ${i}: ${lines[i].slice(0, 200)}`);
      }
    }
  }
}
