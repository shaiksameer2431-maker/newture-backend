/**
 * ground-truth.ts — Direct DB evidence audit for the 22 legitimate NECN questions.
 * Usage: cd backend && npx tsx scripts/ground-truth.ts
 */
import { getDb } from '../src/database/db.js';
import { bm25Search } from '../src/services/retrieval.js';

const QS: [string, string][] = [
  ['Q01', 'What B.Tech programs and courses are available at Narayana Engineering College Nellore?'],
  ['Q02', 'What engineering departments exist at NECN?'],
  ['Q03', 'Tell me about the Computer Science and Engineering CSE department.'],
  ['Q04', 'Tell me about the Mechanical Engineering department.'],
  ['Q05', 'What is the admission procedure and eligibility criteria for B.Tech?'],
  ['Q06', 'What details are available about college fees and admission requirements?'],
  ['Q07', 'Who is the Head of Department HOD for Mechanical Engineering?'],
  ['Q08', 'Who is the Principal of Narayana Engineering College Nellore?'],
  ['Q09', 'What library facilities and central library resources are available?'],
  ['Q10', 'What campus infrastructure, hostel, and canteen facilities exist?'],
  ['Q11', 'What are the placement statistics and top recruiting companies at NECN?'],
  ['Q12', 'Tell me about the Mega Job Mela organized at the college.'],
  ['Q13', 'What career development programs and guidance cell services are offered?'],
  ['Q14', 'What student counseling and guidance programs exist?'],
  ['Q15', 'What are the autonomous academic regulations for students?'],
  ['Q16', 'What academic calendar and examination schedules are available?'],
  ['Q17', 'What sports, games, and athletic activities are available on campus?'],
  ['Q18', 'Tell me about NCC activities and extension programs.'],
  ['Q19', 'What research and development activities take place at NECN?'],
  ['Q20', 'What internal committees like Anti Ragging and Grievance Redressal exist?'],
  ['Q21', 'What information is available in the official college prospectus PDF?'],
  ['Q22', 'Show me the academic regulations document PDF details.'],
];

const KW: Record<string, string[]> = {
  Q01: ['B.Tech', 'programs', 'courses'], Q02: ['departments'], Q03: ['Computer Science', 'CSE'],
  Q04: ['Mechanical'], Q05: ['admission', 'eligibility'], Q06: ['fees'], Q07: ['Head', 'HOD', 'Mechanical'],
  Q08: ['Principal'], Q09: ['library'], Q10: ['hostel', 'canteen', 'infrastructure'],
  Q11: ['placement', 'recruiting'], Q12: ['Mega Job Mela'], Q13: ['career', 'guidance'],
  Q14: ['counseling', 'guidance'], Q15: ['academic regulations'], Q16: ['academic calendar', 'examination'],
  Q17: ['sports', 'games', 'athletic'], Q18: ['NCC', 'extension'], Q19: ['research', 'development'],
  Q20: ['Anti Ragging', 'Grievance'], Q21: ['prospectus'], Q22: ['regulations', 'PDF'],
};

function snip(s: string, n = 240): string {
  const c = (s || '').replace(/\s+/g, ' ').trim();
  return c.length > n ? c.slice(0, n) + '...' : c;
}

async function main() {
  const db = getDb();
  console.log('DB GROUND TRUTH\n');
  for (const [id, query] of QS) {
    console.log('==========================================================');
    console.log(id + ': ' + query);
    const kws = KW[id] || [];
    const clauses: string[] = [];
    const params: string[] = [];
    for (const kw of kws) {
      clauses.push('(c.content LIKE ? OR p.title LIKE ? OR p.url LIKE ?)');
      const pat = '%' + kw + '%';
      params.push(pat, pat, pat);
    }
    let direct: any[] = [];
    if (clauses.length) {
      direct = db.prepare('SELECT c.id chunk_id, c.content, c.embedding_model, p.title, p.url, p.is_active FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE (' + clauses.join(' OR ') + ') LIMIT 6').all(...params) as any[];
    }
    const fts = bm25Search(query, 5);
    console.log('  LIKE hits: ' + direct.length);
    for (const row of direct.slice(0, 3)) {
      console.log('    chunk=' + String(row.chunk_id).slice(0, 24) + ' emb=' + (row.embedding_model || 'MISSING') + ' active=' + row.is_active + ' | ' + row.title + ' | ' + row.url);
      console.log('      ' + snip(row.content));
    }
    console.log('  BM25 hits: ' + fts.length);
    for (const h of fts.slice(0, 3)) {
      console.log('    chunk=' + String(h.chunkId).slice(0, 24) + ' score=' + h.score + ' | ' + h.title + ' | ' + h.url);
      console.log('      ' + snip(h.content));
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });