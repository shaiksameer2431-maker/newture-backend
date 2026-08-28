import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

console.log('=== CHECK FULL CHUNK CONTENT ===\n');

const chunkId = 'c3ecff1e';

const chunk = db.prepare("SELECT id, content FROM website_chunks WHERE id = ?").get(chunkId);
if (chunk) {
  console.log('Full chunk content:');
  console.log(chunk.content);
  console.log('\n---');
  console.log('Total length:', chunk.content.length);
  
  // Find where the actual placement data starts
  const placementIndex = chunk.content.toLowerCase().indexOf('placement');
  const tableIndex = chunk.content.toLowerCase().indexOf('salary');
  const accentureIndex = chunk.content.toLowerCase().indexOf('accenture');
  
  console.log('\nKeyword positions:');
  console.log('  "placement":', placementIndex);
  console.log('  "salary":', tableIndex);
  console.log('  "accenture":', accentureIndex);
  
  if (placementIndex >= 0) {
    console.log('\nContent around "placement":');
    console.log(chunk.content.slice(Math.max(0, placementIndex - 50), placementIndex + 200));
  }
}

db.close();
