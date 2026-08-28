import { getDb } from '../src/database/db.js';

const db = getDb();
const targetUrls = [
  'https://necn.ac.in/courses.php',
  'https://necn.ac.in/placement-records.php',
  'https://necn.ac.in/admission.php',
  'https://necn.ac.in/academic-regulations.php'
];

for (const url of targetUrls) {
  console.log(`\n========================================`);
  console.log(`PAGE URL: ${url}`);
  const page = db.prepare(`SELECT * FROM website_pages WHERE url=?`).get(url) as any;
  if (!page) { console.log('PAGE NOT FOUND'); continue; }
  console.log(`Title: ${page.title} | Active: ${page.is_active}`);
  const chunks = db.prepare(`SELECT id, chunk_index, content FROM website_chunks WHERE page_id=?`).all(page.id) as any[];
  console.log(`Chunk count: ${chunks.length}`);
  chunks.forEach((c, i) => {
    console.log(`--- Chunk [${i+1}] (len ${c.content.length}) ---`);
    console.log(c.content.slice(0, 300));
  });
}
