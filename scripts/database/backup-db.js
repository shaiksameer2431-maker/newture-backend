import fs from 'fs';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'database.db');
const backupsDir = path.join(process.cwd(), 'backups');
if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

const now = new Date();
const timestamp = now.toISOString().replace(/[:.]/g, '-');
const target = path.join(backupsDir, `database-backup-${timestamp}.db`);

try {
  fs.copyFileSync(dbPath, target);
  console.log('Database backup created at:', target);
  process.exit(0);
} catch (err) {
  console.error('Failed to create DB backup:', err);
  process.exit(2);
}