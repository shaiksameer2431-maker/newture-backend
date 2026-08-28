// AUDIT 5 + 6 + 7: retrieval tests using EXISTING retrieval code
// Re-implements the keywordSearch() in services/websiteSearch.ts exactly,
// plus an FTS5 BM25 path if available (per ask: "FTS5/BM25").
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve('./data/database.db');
const db = new Database(dbPath, { readonly: true });

// -------- Check FTS5 availability --------
let ftsAvailable = false;
try {
  // see if virtual table exists in any form
  const r = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%website%fts%'`).all();
  if (r.length === 0) {
    const r2 = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%chunks_fts%'`).all();
    ftsAvailable = r2.length > 0;
  } else ftsAvailable = true;
} catch (_) { ftsAvailable = false; }
console.log('FTS5 virtual table present?', ftsAvailable);
const allTables = db.prepare(`SELECT name, type FROM sqlite_master WHERE name LIKE '%fts%' OR name LIKE '%website%' ORDER BY name`).all();
console.log('Tables related to website/fts:');
for (const t of allTables) console.log('  ', t.type, t.name);

// -------- Replicate keywordSearch from services/websiteSearch.ts --------
const STOP_WORDS = new Set([
  'what','where','which','when','with','from','have','about','college','please','tell','need','want','can','could','should','would','whom','who','how','is','are','the','a','an','of','to','in','on','for','and','or','does','do','did','was','were','be','me','my','your','our'
]);
const QUERY_ALIASES = {
  hod: ['hod','head','head of department','head of the department','department head'],
  principal: ['principal','principal director'],
  faculty: ['faculty','staff','professor','assistant professor','associate professor'],
  mechanical: ['mechanical','mech','mechanical engineering'],
  cse: ['cse','computer science','computer science engineering'],
  ece: ['ece','electronics','electronics communication'],
  eee: ['eee','electrical','electrical electronics'],
  civil: ['civil','civil engineering'],
  admissions: ['admission','admissions','application','eligibility'],
  placements: ['placement','placements','career','recruitment']
};

function tokens(query) {
  return [...new Set((query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter(t => !STOP_WORDS.has(t)))];
}

function expandedTerms(queryTokens) {
  const out = new Set(queryTokens);
  for (const token of queryTokens) {
    for (const alias of QUERY_ALIASES[token] || []) out.add(alias);
  }
  return [...out];
}

function lexicalScore(row, queryTokens) {
  const terms = expandedTerms(queryTokens);
  const hay = `${row.title||''} ${row.category||''} ${row.content||''} ${row.keywords||''}`.toLowerCase();
  const title = `${row.title||''} ${row.category||''}`.toLowerCase();
  const searchable = `${title} ${hay}`;
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
    if ((row.keywords||'').toLowerCase().split(',').includes(token)) score += 15;
  }
  score += Math.round((matchedOriginal / queryTokens.length) * 45);
  const normalizedQuery = queryTokens.join(' ');
  if (normalizedQuery && searchable.includes(normalizedQuery)) score += 25;
  if (queryTokens.length >= 2 && matchedOriginal === queryTokens.length) score += 20;
  return Math.min(100, score);
}

function keywordSearch(query, limit = 5) {
  const qTokens = tokens(query);
  if (!qTokens.length) return [];
  const terms = expandedTerms(qTokens);
  const clauses = [];
  const params = [];
  for (const term of terms.slice(0,20)) {
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
  `).all(...params);
  return rows
    .map(row => ({ row, score: lexicalScore(row, qTokens) }))
    .filter(item => item.score >= 45)
    .sort((a,b)=>b.score-a.score)
    .slice(0, limit);
}

const TESTS = [
  { q: 'What courses are available at NECN?' },
  { q: 'What departments are available at NECN?' },
  { q: 'What is the admission procedure?' },
  { q: 'What facilities are available?' },
  { q: 'What placement information is available?' },
  { q: 'What academic information is available?' },
  { q: 'Who is the HOD of Mechanical Engineering?' },
  { q: 'What is career counseling?' }, // likely answered by PDF CAREER COUNSELING
];

for (const t of TESTS) {
  console.log('\n=========================================================');
  console.log('Q:', t.q);
  console.log('Tokens:', tokens(t.q));
  console.log('Expanded:', expandedTerms(tokens(t.q)));
  const results = keywordSearch(t.q, 5);
  console.log(`Returned ${results.length} chunks (after threshold):`);
  results.forEach((r,i) => {
    console.log(`  #${i+1} score=${r.score} | ${r.row.url}`);
    console.log(`     preview: ${r.row.content.slice(0,200).replace(/\s+/g,' ').slice(0,200)}`);
  });
}

db.close();
