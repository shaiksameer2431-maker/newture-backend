import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

console.log('=== CHECK FACILITIES CHUNK CONTENT ===\n');

const chunkId = '3a22e430-3c90-4900-81d1-82e821aaf511';

const chunk = db.prepare("SELECT id, content FROM website_chunks WHERE id = ?").get(chunkId);
if (chunk) {
  console.log('Full chunk content:');
  console.log(chunk.content);
  console.log('\n---');
  console.log('Total length:', chunk.content.length);
  
  // Find key terms
  const canteenIndex = chunk.content.toLowerCase().indexOf('canteen');
  const hostelIndex = chunk.content.toLowerCase().indexOf('hostel');
  const infrastructureIndex = chunk.content.toLowerCase().indexOf('infrastructure');
  const stakeholdersIndex = chunk.content.toLowerCase().indexOf('stakeholders');
  
  console.log('\nKeyword positions:');
  console.log('  "canteen":', canteenIndex);
  console.log('  "hostel":', hostelIndex);
  console.log('  "infrastructure":', infrastructureIndex);
  console.log('  "stakeholders":', stakeholdersIndex);
  
  if (canteenIndex >= 0) {
    console.log('\nContent around "canteen":');
    console.log(chunk.content.slice(Math.max(0, canteenIndex - 100), canteenIndex + 300));
  }
}

db.close();
