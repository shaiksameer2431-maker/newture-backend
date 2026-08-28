// dump-chunks.ts - Dump raw content of critical chunks for the 5 failed questions
import { getDb } from '../src/database/db.js';

const CHUNKS = [
  'c03610ee', // admission.php
  '2d27fb4d', // college-Fees.php
  '3a22e430', // facilites.php
  '6bcc0cf7', // research-activites.php
  '7173c8d6', // placement-records.php
  'c3ecff1e', // 2023-24-placements.php
];

const db = getDb();
for (const prefix of CHUNKS) {
  const row = db.prepare(
    'SELECT c.id, c.content, c.chunk_index, p.url, p.title, p.is_active FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE c.id LIKE ?'
  ).get(prefix + '%') as any;
  if (!row) { console.log('=== ' + prefix + ' NOT FOUND ===\n'); continue; }
  console.log('=== ' + row.url + ' | chunk=' + row.id + ' | len=' + row.content.length + ' | active=' + row.is_active + ' ===');
  console.log(row.content);
  console.log('\n');
}