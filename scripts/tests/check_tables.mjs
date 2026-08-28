import { getDb } from '../../src/database/db.js';

const db = getDb();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables in necn.db:', tables.map(t => t.name));
