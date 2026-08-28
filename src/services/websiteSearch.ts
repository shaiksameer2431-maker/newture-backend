import { getDb } from '../database/db.js';
import { bm25Search, fts5Available } from './retrieval.js';
import { semanticSearchWebsite, generateGroundedAnswer, type SemanticChunk } from './semanticRag.js';

export interface WebsiteSearchResult {
  answer: string;
  source: string;
  pageTitle: string;
  website: string;
  confidence: number;
  lastUpdated: string;
  isConfident: boolean;
  url: string;
  category: string;
  chunkId: string;
  retrievalMode: 'semantic' | 'keyword' | 'fts5';
}

const STOP_WORDS = new Set([
  'what','where','which','when','with','from','have','about','college','please','tell','need','want','can','could','should','would','whom','who','how','is','are','the','a','an','of','to','in','on','for','and','or','does','do','did','was','were','be','me','my','your','our'
]);

const QUERY_ALIASES: Record<string, string[]> = {
  hod: ['hod', 'head', 'head of department', 'head of the department', 'department head'],
  principal: ['principal', 'principal director'],
  faculty: ['faculty', 'staff', 'professor', 'assistant professor', 'associate professor'],
  mechanical: ['mechanical', 'mech', 'mechanical engineering'],
  cse: ['cse', 'computer science', 'computer science engineering'],
  ece: ['ece', 'electronics', 'electronics communication'],
  eee: ['eee', 'electrical', 'electrical electronics'],
  civil: ['civil', 'civil engineering'],
  admissions: ['admission', 'admissions', 'application', 'eligibility'],
  placements: ['placement', 'placements', 'career', 'recruitment', 'statistics', 'companies', 'recruiting', 'salary', 'package', 'job mela'],
  statistics: ['placement', 'placements', 'recruiting', 'companies', 'salary', 'package', 'data', 'records'],
  infrastructure: ['facilities', 'facility', 'building', 'campus', 'canteen', 'hostel', 'library', 'gym', 'auditorium'],
  hostel: ['hostel', 'hostels', 'accommodation', 'residential', 'dormitory'],
  canteen: ['canteen', 'cafeteria', 'food', 'mess', 'dining'],
  research: ['research', 'development', 'rd', 'innovation', 'projects', 'publication']
};

function tokens(query: string): string[] {
  return [...new Set((query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter(t => !STOP_WORDS.has(t)))];
}

function expandedTerms(queryTokens: string[]): string[] {
  const out = new Set(queryTokens);
  for (const token of queryTokens) {
    for (const alias of QUERY_ALIASES[token] || []) out.add(alias);
  }
  return [...out];
}

function lexicalScore(row: any, queryTokens: string[]): number {
  const terms = expandedTerms(queryTokens);
  const hay = `${row.title || ''} ${row.category || ''} ${row.content || ''} ${row.keywords || ''}`.toLowerCase();
  const title = `${row.title || ''} ${row.category || ''}`.toLowerCase();
  const searchable = `${title} ${hay}`;
  const url = (row.url || '').toLowerCase();

  if (!queryTokens.length) return 0;
  let matchedOriginal = 0;
  let score = 0;

  for (const token of queryTokens) {
    const aliases = QUERY_ALIASES[token] || [token];
    const matchedAlias = aliases.some(alias => searchable.includes(alias));
    if (matchedAlias) {
      matchedOriginal++;
      score += 28;
    }
    if (hay.includes(` ${token} `) || hay.includes(token)) score += 10;
    if (title.includes(token)) score += 18;
    if ((row.keywords || '').toLowerCase().split(',').includes(token)) score += 15;
  }

  // Strong bonus when all user intent tokens are represented in the same chunk.
  score += Math.round((matchedOriginal / queryTokens.length) * 45);

  // Phrase-level bonus: "mechanical hod" should strongly prefer a chunk that
  // contains both concepts, even when the document's exact wording is "Professor & HOD".
  const normalizedQuery = queryTokens.join(' ');
  if (normalizedQuery && searchable.includes(normalizedQuery)) score += 25;
  if (queryTokens.length >= 2 && matchedOriginal === queryTokens.length) score += 20;

  // URL-based boosting for specific page types
  if (url.includes('placement')) score += 15;
  if (url.includes('placement') && (url.includes('2023') || url.includes('2024') || url.includes('2022'))) score += 25;
  if (url.includes('facilities') || url.includes('facility')) score += 15;
  if (url.includes('admission')) score += 15;
  if (url.includes('research')) score += 15;

  // Boost for numeric data and tables (placement statistics)
  if (hay.includes('LPA') || hay.includes('lpa')) score += 20;
  if (hay.includes('Accenture') || hay.includes('TCS') || hay.includes('Infosys')) score += 15;
  if (hay.includes('|') && hay.includes('salary')) score += 10;

  return Math.min(100, score);
}

async function legacyLikeSearch(query: string, limit: number): Promise<WebsiteSearchResult[]> {
  const db = getDb();
  const qTokens = tokens(query);
  if (!qTokens.length) return [];

  const terms = expandedTerms(qTokens);
  const clauses: string[] = [];
  const params: string[] = [];

  for (const term of terms.slice(0, 20)) {
    clauses.push('(p.title LIKE ? OR p.category LIKE ? OR c.content LIKE ? OR c.keywords LIKE ?)');
    const pattern = `%${term}%`;
    params.push(pattern, pattern, pattern, pattern);
  }

  const rows = db.prepare(`
    SELECT c.id AS chunk_id, c.content, c.keywords, c.created_at,
           p.title, p.category, p.url, p.last_changed, p.content_type
    FROM website_chunks c
    JOIN website_pages p ON p.id = c.page_id
    WHERE p.is_active = 1 AND (${clauses.join(' OR ')})
    LIMIT 500
  `).all(...params) as any[];

  return rows
    .map(row => ({ row, score: lexicalScore(row, qTokens) }))
    .filter(item => qTokens.every(token => (QUERY_ALIASES[token] || [token]).some(alias => `${item.row.title || ''} ${item.row.category || ''} ${item.row.content || ''} ${item.row.keywords || ''}`.toLowerCase().includes(alias))))
    .filter(item => item.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row, score }) => ({
      answer: row.content,
      source: 'NECN Official Website',
      pageTitle: row.title || 'NECN Website',
      website: 'Narayana Engineering College, Nellore',
      confidence: score,
      lastUpdated: row.last_changed || row.created_at || new Date().toISOString(),
      isConfident: score >= 70,
      url: row.url,
      category: row.category || 'General',
      chunkId: row.chunk_id,
      retrievalMode: 'keyword'
    }));
}

async function keywordSearch(query: string, limit: number): Promise<WebsiteSearchResult[]> {
  // Prefer BM25 via FTS5 when available. This dramatically reduces the
  // nav-chrome noise that the previous LIKE-based path surfaced.
  if (fts5Available()) {
    try {
      const hits = bm25Search(query, limit);
      if (hits.length) {
        return hits.map(hit => ({
          answer: hit.content,
          source: 'NECN Official Website',
          pageTitle: hit.title || 'NECN Website',
          website: 'Narayana Engineering College, Nellore',
          confidence: hit.score,
          lastUpdated: new Date().toISOString(),
          // Scores below 70 are insufficient for factual answers; do not
          // invoke the local generator on weak or navigation-heavy evidence.
          isConfident: hit.score >= 70,
          url: hit.url,
          category: hit.section || 'General',
          chunkId: hit.chunkId,
          retrievalMode: 'fts5'
        }));
      }
    } catch (error) {
      console.warn('[WEBSITE SEARCH] BM25 search failed; using legacy LIKE fallback:', error instanceof Error ? error.message : error);
    }
  }
  return legacyLikeSearch(query, limit);
}

function semanticToWebsiteResult(row: SemanticChunk): WebsiteSearchResult {
  const normalizedConfidence = Math.min(100, Math.max(50, Math.round(row.similarity * 100 + 20)));
  return {
    answer: row.content,
    source: 'NECN Official Website',
    pageTitle: row.title,
    website: 'Narayana Engineering College, Nellore',
    confidence: normalizedConfidence,
    lastUpdated: row.lastUpdated,
    isConfident: normalizedConfidence >= 60,
    url: row.url,
    category: row.category,
    chunkId: row.chunkId,
    retrievalMode: 'semantic'
  };
}

export async function searchWebsiteKnowledge(query: string, limit = 5, language = 'English'): Promise<WebsiteSearchResult[]> {
  console.log('[CHAT PIPELINE] RETRIEVAL_START');
  const [lexical, semantic] = await Promise.all([
    keywordSearch(query, Math.max(limit * 3, 12)).then(res => {
      console.log(`[CHAT PIPELINE] FTS_COMPLETE hits=${res.length}`);
      return res;
    }),
    semanticSearchWebsite(query, Math.max(limit * 3, 12)).then(res => {
      console.log(`[CHAT PIPELINE] SEMANTIC_COMPLETE hits=${res.length}`);
      return res;
    }).catch(() => {
      console.log('[CHAT PIPELINE] SEMANTIC_COMPLETE hits=0 (fallback)');
      return [];
    })
  ]);
  const merged = new Map<string, { result: WebsiteSearchResult; score: number }>();
  lexical.forEach((result, index) => merged.set(result.chunkId, { result, score: 1 / (50 + index + 1) }));
  semantic.forEach((hit, index) => {
    const existing = merged.get(hit.chunkId);
    const result = semanticToWebsiteResult(hit);
    const score = (existing?.score || 0) + 1 / (50 + index + 1) + hit.similarity * 0.15;
    merged.set(hit.chunkId, { result: existing?.result || result, score });
  });
  let selected = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit).map(item => item.result);
  console.log(`[CHAT PIPELINE] RERANK_COMPLETE selected=${selected.length}`);
  if (!selected.length) return [];

  // Special citation mapping: For Principal queries, ensure top candidate is Principal's Profile
  if (/\b(principal|head of institution)\b/i.test(query) && !/\b(director)\b/i.test(query)) {
    const pIdx = selected.findIndex(item => (item.url || '').toLowerCase().includes('prinicpal-desk'));
    if (pIdx > 0) {
      const [pItem] = selected.splice(pIdx, 1);
      selected.unshift(pItem);
    } else if (pIdx === -1) {
      // Look up Principal desk page directly from DB if not in top hits
      const db = getDb();
      const pRow = db.prepare(`SELECT p.title, p.url, c.id chunk_id, c.content FROM website_pages p JOIN website_chunks c ON c.page_id=p.id WHERE p.is_active=1 AND (p.url LIKE '%prinicpal-desk%' OR p.title LIKE '%Principal%') LIMIT 1`).get() as any;
      if (pRow) {
        selected.unshift({
          answer: pRow.content,
          source: 'NECN Official Website',
          pageTitle: "Principal's Profile",
          website: 'Narayana Engineering College, Nellore',
          confidence: 100,
          lastUpdated: new Date().toISOString(),
          isConfident: true,
          url: pRow.url,
          category: 'Administration',
          chunkId: pRow.chunk_id,
          retrievalMode: 'semantic'
        });
      }
    }
    if (selected[0] && (selected[0].url || '').includes('prinicpal-desk')) {
      selected[0].pageTitle = "Principal's Profile";
    }
  }

  // Special citation mapping: For Director queries
  if (/\b(director)\b/i.test(query)) {
    const dIdx = selected.findIndex(item => (item.url || '').toLowerCase().includes('director-desk'));
    if (dIdx > 0) {
      const [dItem] = selected.splice(dIdx, 1);
      selected.unshift(dItem);
    } else if (dIdx === -1) {
      const db = getDb();
      const dRow = db.prepare(`SELECT p.title, p.url, c.id chunk_id, c.content FROM website_pages p JOIN website_chunks c ON c.page_id=p.id WHERE p.is_active=1 AND (p.url LIKE '%director-desk%' OR p.title LIKE '%Director%') LIMIT 1`).get() as any;
      if (dRow) {
        selected.unshift({
          answer: dRow.content,
          source: 'NECN Official Website',
          pageTitle: "Director's Profile",
          website: 'Narayana Engineering College, Nellore',
          confidence: 100,
          lastUpdated: new Date().toISOString(),
          isConfident: true,
          url: dRow.url,
          category: 'Administration',
          chunkId: dRow.chunk_id,
          retrievalMode: 'semantic'
        });
      }
    }
    if (selected[0] && (selected[0].url || '').includes('director-desk')) {
      selected[0].pageTitle = "Director's Profile";
    }
  }

  const strongest = Math.max(...selected.map(result => result.confidence));
  if (strongest < 15) {
    console.log(`[CHAT PIPELINE] EVIDENCE_REJECTED confidence=${strongest}% threshold=15%`);
    return [];
  }
  const evidence = selected.map(result => ({ chunkId: result.chunkId, pageId: '', content: result.answer, title: result.pageTitle, category: result.category, url: result.url, similarity: result.retrievalMode === 'semantic' ? result.confidence / 100 : 0, lexicalScore: result.confidence / 100, combinedScore: result.confidence / 100, lastUpdated: result.lastUpdated }));
  console.log(`[CHAT PIPELINE] EVIDENCE_SELECTED count=${evidence.length}`);
  const NO_EVIDENCE_PATTERNS = /does not (mention|provide|contain|have)|is not (mentioned|provided|relevant|found)|not provided|no evidence|insufficient evidence|NOT_FOUND|^[-—\s]+$/i;
  const answer = await generateGroundedAnswer(query, evidence, language);
  if (answer && !NO_EVIDENCE_PATTERNS.test(answer)) {
    selected[0] = { ...selected[0], answer, isConfident: true };
    return selected;
  } else if (evidence.length > 0) {
    const rawFallback = evidence[0].content.replace(/##H\d##|##TR##|##TABLE##/g, ' ').replace(/\s+/g, ' ').trim();
    if (rawFallback.length >= 20) {
      selected[0] = { ...selected[0], answer: rawFallback.slice(0, 450), isConfident: true };
      return selected;
    }
  }
  return [];
}

export async function backfillWebsiteEmbeddings(limit = 40) {
  const { embedPendingWebsiteChunks, drainAllPendingWebsiteChunks } = await import('./semanticRag.js');
  if (limit <= 0) return drainAllPendingWebsiteChunks();
  return embedPendingWebsiteChunks(limit);
}
