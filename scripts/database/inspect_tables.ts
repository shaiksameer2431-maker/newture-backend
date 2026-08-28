import { getDb } from './src/database/db.js';

const db = getDb();
const depts = db.prepare("SELECT * FROM departments").all();
console.log("DEPARTMENTS:", JSON.stringify(depts, null, 2));

const facultyCount = (db.prepare("SELECT count(*) n FROM faculty").get() as any).n;
console.log(`FACULTY COUNT: ${facultyCount}`);
