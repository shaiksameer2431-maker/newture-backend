import { getDb } from './src/database/db.js';

const db = getDb();

console.log("=== DEPARTMENTS TABLE ===");
const depts = db.prepare(`SELECT * FROM departments`).all();
console.log(JSON.stringify(depts, null, 2));

console.log("\n=== FACULTY TABLE ===");
const faculty = db.prepare(`SELECT id, name, designation, department, email, contact FROM faculty`).all();
console.log(JSON.stringify(faculty, null, 2));
