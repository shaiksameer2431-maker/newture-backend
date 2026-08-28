import { getDb } from '../../src/database/db.js';

const db = getDb();
const rows = db.prepare('SELECT code, name, hod, contact_number, email FROM departments').all();
console.log('Departments Table Contents:');
console.table(rows);
