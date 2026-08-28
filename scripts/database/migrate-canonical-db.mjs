import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = resolve(root, '../data/database.db');
const target = resolve(root, 'data/necn.db');
if (!existsSync(source)) throw new Error(`Source database not found: ${source}`);
mkdirSync(dirname(target), { recursive: true });
if (!existsSync(target)) copyFileSync(source, target);
const db = new Database(target, { readonly: true });
const integrity = db.pragma('integrity_check', { simple: true });
if (integrity !== 'ok') throw new Error(`Integrity check failed: ${integrity}`);
const counts = Object.fromEntries(['website_pages', 'website_chunks', 'rules', 'users', 'support_tickets'].map(table => [table, Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n)]));
const fts = Number(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='chunks_fts'").get().n) === 1;
db.close();
console.log(JSON.stringify({ source, target, integrity, fts5: fts, counts }, null, 2));
