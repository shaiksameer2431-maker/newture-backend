import { getDb } from './src/database/db.js';

const db = getDb();

console.log("=== FULL CONTENT OF ACADEMIC LEADERSHIP PAGE ===");
const leadPage = db.prepare(`SELECT c.id, c.content, p.url FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.url LIKE '%academic-leadership%'`).all() as any[];
for (const c of leadPage) {
  console.log(`--- CHUNK ${c.id} (${c.url}) ---`);
  console.log(c.content);
}

console.log("\n=== FULL CONTENT OF DEPARTMENTS TABLE ===");
const depts = db.prepare(`SELECT * FROM departments`).all();
console.log(JSON.stringify(depts, null, 2));

console.log("\n=== FULL CONTENT OF FACULTY TABLE ===");
const faculty = db.prepare(`SELECT id, name, designation, department, email, contact FROM faculty`).all();
console.log(JSON.stringify(faculty, null, 2));

console.log("\n=== FULL CONTENT OF CONTACT US / ADMISSIONS PAGES ===");
const contactPages = db.prepare(`SELECT c.id, c.content, p.title, p.url FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.url LIKE '%contact%' OR p.url LIKE '%admission%'`).all() as any[];
for (const c of contactPages) {
  console.log(`--- PAGE ${c.title} (${c.url}) CHUNK ${c.id} ---`);
  console.log(c.content.slice(0, 1000));
}
