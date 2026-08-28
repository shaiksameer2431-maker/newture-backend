/**
 * retrieval.ts — FTS5 BM25 search with title/section/URL bonuses and intent
 * filtering. Falls back to a LIKE-based lexical search when FTS5 is missing.
 *
 * Never fabricates content. If the search returns no hits, callers should
 * return the standardized "Information not found" message.
 */

import { getDb, fts5Available as _fts5Available } from '../database/db.js';
import { detectIntent, applyIntentBonus } from './intent.js';

export const fts5Available = _fts5Available;

export interface Bm25Hit {
  chunkId: string;
  pageId: string;
  url: string;
  title: string;
  section: string | null;
  department: string | null;
  content: string;
  bm25: number;
  bonus: number;
  score: number;
  intent: string | null;
  retrievalMode: 'fts5' | 'like-fallback';
}

const LOW_INFO = new Set([
  'what','where','which','when','with','from','have','about','college',
  'please','tell','need','want','can','could','should','would','whom','who',
  'how','is','are','the','a','an','to','of','for','on','in','and','or',
  'does','do','did','was','were','be','me','my','your','our',
  'available','information','general','details','list','give','find','show',
  'necn','website','site','pages','page','tell','please','need','want'
]);

const ALIASES: Record<string, string[]> = {
  mechanical: ['mechanical','mech'],
  cse: ['cse','computer','computerscience','computer science','computer science engineering'],
  ece: ['ece','electronics','electronics communication','electronicscommunication'],
  eee: ['eee','electrical','electrical electronics','electricalelectronics'],
  civil: ['civil','civil engineering','civilengineering'],
  hod: ['hod','head','head of','department head','head of department','head of the department'],
  admissions: ['admission','admissions','application','eligibility','procedure'],
  placements: ['placement','placements','career','recruitment','recruiters','companies','salary','lpa'],
  facilities: ['facilities','facility','library','lab','laboratory','hostel','sports','infrastructure'],
  regulations: ['regulation','regulations','academic regulations','academicregulation'],
  counseling: ['counseling','counselling','counsel','guidance']
};

function tokens(query: string): string[] {
  return [...new Set((query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])
    .filter(t => !LOW_INFO.has(t) && t.length >= 2))];
}

function expandTerms(queryTokens: string[]): string[] {
  const out = new Set(queryTokens);
  for (const t of queryTokens) for (const a of ALIASES[t] || []) out.add(a);
  return [...out];
}

function escapeFts(t: string): string {
  // Quote tokens that contain non-word chars so FTS5 doesn't choke.
  if (/[^\w]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return `${t}*`;
}

export function bm25Search(query: string, limit = 5, opts: { db?: any } = {}): Bm25Hit[] {
  if (!fts5Available()) return likeFallback(query, limit, opts);
  const db = opts.db || getDb();
  const intent = detectIntent(query);

  const queryTokens = tokens(query);
  if (!queryTokens.length) return [];
  const expanded = expandTerms(queryTokens);
  const ftsQuery = expanded.map(escapeFts).join(' OR ') || '""';

  // Bonus patterns: title / section / URL. We pass these as LIKE parameters.
  const primaryPattern = `%${queryTokens[0]}%`;

  let rows: any[];
  try {
    rows = db.prepare(`
      SELECT
        c.id AS chunk_id, c.page_id, c.content, c.section, c.department, c.chunk_index,
        p.url, COALESCE(p.clean_title, p.title) AS title,
        bm25(chunks_fts) AS bm25_score
      FROM chunks_fts
      JOIN website_chunks c ON c.id = chunks_fts.chunk_id
      JOIN website_pages  p ON p.id = c.page_id
      WHERE chunks_fts MATCH ?
        AND p.is_active = 1
      ORDER BY bm25_score ASC
      LIMIT ?
    `).all(ftsQuery, Math.min(250, limit * 30)) as any[];
  } catch (e) {
    console.warn('[RETRIEVAL] FTS5 query failed; falling back to LIKE:', e instanceof Error ? e.message : e);
    return likeFallback(query, limit, opts);
  }

  if (!rows.length) return [];

  const hits: Bm25Hit[] = rows.map(row => {
    const bm25 = -Number(row.bm25_score);
    const titleBonus = expanded.some(t => t.length >= 3 && (row.title || '').toLowerCase().includes(t)) ? 25 : 0;
    const urlBonus = expanded.some(t => t.length >= 3 && (row.url || '').toLowerCase().includes(t)) ? 35 : 0;
    const sectionBonus = expanded.some(t => t.length >= 3 && (row.section || '').toLowerCase().includes(t)) ? 20 : 0;
    const bonus = titleBonus + urlBonus + sectionBonus;

    const intentBonus = applyIntentBonus(intent.tag, {
      chunkId: row.chunk_id, pageId: row.page_id, url: row.url,
      title: row.title, section: row.section, department: row.department,
      content: row.content, bm25, bonus, score: 0, intent: intent.tag,
      retrievalMode: 'fts5'
    });
    // Combine BM25 magnitude with bonuses; clamp to 0-100.
    const navigationNoise = /^https?:\/\/[^/]+\/?(?:site-map\.php)?$/i.test(row.url || '') ||
      (row.content.match(/•/g) || []).length >= 6;
    // SQLite's bm25() returns small negative values. Convert its magnitude to
    // a stable 0-100 component, then make page/section evidence decisive.
    const raw = bm25 * 50 + bonus + intentBonus - (navigationNoise ? 45 : 0);
    const score = Math.max(0, Math.min(100, Math.round(raw)));
    return {
      chunkId: row.chunk_id,
      pageId: row.page_id,
      url: row.url,
      title: row.title,
      section: row.section,
      department: row.department,
      content: row.content,
      bm25,
      bonus: bonus + intentBonus,
      score,
      intent: intent.tag,
      retrievalMode: 'fts5'
    };
  });

  return hits
    // FTS uses OR expansion for recall. Require every meaningful user term in
    // the final evidence so a single incidental navigation word cannot answer
    // an unrelated question (for example, an unknown "quantum teleportation"
    // query matching only a site-wide "quantum" link).
    .filter(h => {
      const searchable = `${h.title} ${h.section || ''} ${h.department || ''} ${h.url} ${h.content}`.toLowerCase();
      const matchedCount = queryTokens.filter(term => (ALIASES[term] || [term]).some(alias => searchable.includes(alias))).length;
      return matchedCount >= Math.min(queryTokens.length, Math.ceil(queryTokens.length * 0.5));
    })
    .filter(h => h.score >= 15)
    .sort((a, b) => {
      if (intent.tag === 'department_head') {
        const ae = /hod[-\s:]*[a-z]+/i.test(a.content) ? 1 : 0;
        const be = /hod[-\s:]*[a-z]+/i.test(b.content) ? 1 : 0;
        if (ae !== be) return be - ae;
      }
      return b.score - a.score;
    })
    .slice(0, limit);
}

// ---- LIKE fallback ----

const STOP_WORDS = new Set([
  'what','where','which','when','with','from','have','about','college','please','tell','need','want','can','could','should','would','whom','who','how','is','are','the','a','an','of','to','in','on','for','and','or','does','do','did','was','were','be','me','my','your','our'
]);

function likeTokens(query: string): string[] {
  return [...new Set((query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter(t => !STOP_WORDS.has(t)))];
}

function lexicalScore(row: any, queryTokens: string[]): number {
  const hay = `${row.title || ''} ${row.category || ''} ${row.content || ''} ${row.keywords || ''}`.toLowerCase();
  const title = `${row.title || ''} ${row.category || ''}`.toLowerCase();
  const searchable = `${title} ${hay}`;
  if (!queryTokens.length) return 0;
  let matchedOriginal = 0;
  let score = 0;
  for (const token of queryTokens) {
    const aliases = ALIASES[token] || [token];
    const matchedAlias = aliases.some(a => searchable.includes(a));
    if (matchedAlias) { matchedOriginal++; score += 28; }
    if (hay.includes(` ${token} `) || hay.includes(token)) score += 10;
    if (title.includes(token)) score += 18;
    if ((row.keywords || '').toLowerCase().split(',').includes(token)) score += 15;
  }
  score += Math.round((matchedOriginal / queryTokens.length) * 45);
  const normalizedQuery = queryTokens.join(' ');
  if (normalizedQuery && searchable.includes(normalizedQuery)) score += 25;
  if (queryTokens.length >= 2 && matchedOriginal === queryTokens.length) score += 20;
  return Math.min(100, score);
}

function likeFallback(query: string, limit: number, opts: { db?: any }): Bm25Hit[] {
  const db = opts.db || getDb();
  const qTokens = likeTokens(query);
  if (!qTokens.length) return [];
  const terms = expandTerms(qTokens);

  const clauses: string[] = [];
  const params: any[] = [];
  for (const term of terms.slice(0, 20)) {
    clauses.push('(p.title LIKE ? OR p.category LIKE ? OR c.content LIKE ? OR c.keywords LIKE ?)');
    const pattern = `%${term}%`;
    params.push(pattern, pattern, pattern, pattern);
  }

  let rows: any[];
  try {
    rows = db.prepare(`
      SELECT c.id AS chunk_id, c.content, c.keywords, c.section, c.department,
             p.title, p.category, p.url, p.last_changed, p.content_type
      FROM website_chunks c
      JOIN website_pages p ON p.id = c.page_id
      WHERE p.is_active = 1 AND (${clauses.join(' OR ')})
      LIMIT 500
    `).all(...params) as any[];
  } catch (e) {
    console.warn('[RETRIEVAL] LIKE fallback query failed:', e instanceof Error ? e.message : e);
    return [];
  }

  return rows
    .map(row => ({ row, score: lexicalScore(row, qTokens) }))
    .filter(item => qTokens.every(term => (ALIASES[term] || [term]).some(alias => `${item.row.title || ''} ${item.row.category || ''} ${item.row.content || ''} ${item.row.keywords || ''}`.toLowerCase().includes(alias))))
    .filter(item => item.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row, score }) => ({
      chunkId: row.chunk_id,
      pageId: '',
      url: row.url,
      title: row.title || 'NECN Website',
      section: row.section || null,
      department: row.department || null,
      content: row.content,
      bm25: 0,
      bonus: 0,
      score,
      intent: null,
      retrievalMode: 'like-fallback'
    }));
}
