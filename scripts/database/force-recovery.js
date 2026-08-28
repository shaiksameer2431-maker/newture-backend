import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'database.db');
const db = new Database(dbPath);

console.log('=== FORCING STALE JOB RECOVERY ===\n');

// Update the running job to have an old heartbeat
const oldHeartbeat = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 minutes ago
const result = db.prepare("UPDATE crawl_jobs SET last_heartbeat_at=? WHERE status='running'").run(oldHeartbeat);
console.log(`Updated ${result.changes} running jobs to have old heartbeat`);

// Check current state
const jobs = db.prepare("SELECT id, status, last_heartbeat_at FROM crawl_jobs WHERE status='running'").all();
console.log('\nCurrent running jobs:');
jobs.forEach(job => {
  console.log(`  ID: ${job.id}`);
  console.log(`  Status: ${job.status}`);
  console.log(`  Last Heartbeat: ${job.last_heartbeat_at}`);
});

db.close();
