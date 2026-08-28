import { getDb } from './src/database/db.js';

const db = getDb();
const rules = db.prepare("SELECT id, question, answer, category FROM rules WHERE status='Active'").all();
console.log(`Active rules count: ${rules.length}`);
for (const r of rules as any[]) {
  console.log(`[${r.id}] ${r.category}: ${r.question} => ${r.answer.slice(0, 60)}...`);
}
