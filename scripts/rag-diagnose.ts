/**
 * rag-diagnose.ts — Targeted RAG failure diagnosis for the 22 legitimate NECN questions.
 * Uses the actual production pipeline (findBestStrictAnswer) + raw retrieval captures.
 * Usage: cd backend && npx tsx scripts/rag-diagnose.ts
 */
import { getDb } from '../src/database/db.js';
import { bm25Search, fts5Available } from '../src/services/retrieval.js';
import { semanticSearchWebsite } from '../src/services/semanticRag.js';
import { localLlm } from '../src/services/localLlm.js';
import { findBestStrictAnswer } from '../src/services/knowledgeEngine.js';

const QS: [number, string][] = [
  [1, 'What B.Tech programs and courses are available at Narayana Engineering College Nellore?'],
  [2, 'What engineering departments exist at NECN?'],
  [3, 'Tell me about the Computer Science and Engineering CSE department.'],
  [4, 'Tell me about the Mechanical Engineering department.'],
  [5, 'What is the admission procedure and eligibility criteria for B.Tech?'],
  [6, 'What details are available about college fees and admission requirements?'],
  [7, 'Who is the Head of Department HOD for Mechanical Engineering?'],
  [8, 'Who is the Principal of Narayana Engineering College Nellore?'],
  [9, 'What library facilities and central library resources are available?'],
  [10, 'What campus infrastructure, hostel, and canteen facilities exist?'],
  [11, 'What are the placement statistics and top recruiting companies at NECN?'],
  [12, 'Tell me about the Mega Job Mela organized at the college.'],
  [13, 'What career development programs and guidance cell services are offered?'],
  [14, 'What student counseling and guidance programs exist?'],
  [15, 'What are the autonomous academic regulations for students?'],
  [16, 'What academic calendar and examination schedules are available?'],
  [17, 'What sports, games, and athletic activities are available on campus?'],
  [18, 'Tell me about NCC activities and extension programs.'],
  [19, 'What research and development activities take place at NECN?'],
  [20, 'What internal committees like Anti Ragging and Grievance Redressal exist?'],
  [21, 'What information is available in the official college prospectus PDF?'],
  [22, 'Show me the academic regulations document PDF details.'],
];

function snip(s: string, n = 160): string {
  const c = String(s || '').replace(/\s+/g, ' ').trim();
  return c.length > n ? c.slice(0, n) + '...' : c;
}

async function run() {
  const db = getDb();
  console.log('==================================================================');
  console.log('RAG TARGETED DIAGNOSIS - 22 LEGITIMATE NECN QUESTIONS');
  console.log('==================================================================\n');

  const totalChunks = (db.prepare('SELECT count(*) n FROM website_chunks').get() as any).n;
  const activeChunks = (db.prepare('SELECT count(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1').get() as any).n;
  const embeddedActive = (db.prepare("SELECT count(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1 AND c.embedding_json IS NOT NULL AND c.embedding_model='Xenova/all-MiniLM-L6-v2'").get() as any).n;
  const inactiveChunks = (db.prepare('SELECT count(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=0').get() as any).n;
  const missingEmb = (db.prepare('SELECT count(*) n FROM website_chunks WHERE embedding_json IS NULL').get() as any).n;
  console.log('EMBEDDING/ACTIVITY AUDIT');
  console.log('  totalChunks=' + totalChunks);
  console.log('  activeChunks=' + activeChunks + ' inactiveChunks=' + inactiveChunks);
  console.log('  activeEmbedded(miniLm)=' + embeddedActive + ' totalMissingEmbedding=' + missingEmb);
  console.log('  fts5=' + fts5Available() + ' llm=' + (await localLlm.load() ? 'LOCAL' : 'UNAVAILABLE'));
  console.log('');

  const results: { q: number; query: string; grounded: boolean; answer: string | null; confidence: number; latency: number; sources: string[]; mode: string; bm25Top: string[]; semTop: string[]; err: string }[] = [];

  for (const [id, query] of QS) {
    const t0 = performance.now();
    let res: any = null;
    let err = '';
    try {
      res = await findBestStrictAnswer(query, 'English');
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    const latency = Math.round(performance.now() - t0);
    const grounded = Boolean(res && res.isConfident);
    const answer = res ? res.answer : null;
    const confidence = res ? res.confidence : 0;
    const sources = (res && (res.sources || [])) ? res.sources.map((s: any) => (s.title || '') + ' | ' + (s.url || '') + ' | ' + (s.chunkId || '')) : [];
    const mode = res ? (res.grounded ? 'LOCAL_LLM_GROUNDED' : 'LOCAL_LLM') : 'REJECTED';

    // Raw retrieval capture (without LLM)
    let bm25Top: string[] = [];
    let semTop: string[] = [];
    try {
      bm25Top = bm25Search(query, 10).map((h: any) => 'c=' + String(h.chunkId).slice(0, 8) + ' score=' + h.score + ' ' + (h.title || ''));
    } catch (e) { bm25Top = ['ERR ' + (e instanceof Error ? e.message : e)]; }
    try {
      semTop = (await semanticSearchWebsite(query, 10)).map((h: any) => 'c=' + String(h.chunkId).slice(0, 8) + ' sim=' + h.similarity.toFixed(3) + ' ' + (h.title || ''));
    } catch (e) { semTop = ['ERR ' + (e instanceof Error ? e.message : e)]; }

    results.push({ q: id, query, grounded, answer, confidence, latency, sources, mode, bm25Top, semTop, err });
  }

  console.log('PER-QUESTION DIAGNOSTIC');
  console.log('==================================================================');
  const failed: number[] = [];
  let totalLatency = 0;
  for (const r of results) {
    totalLatency += r.latency;
    const pass = r.grounded;
    if (!pass) failed.push(r.q);
    console.log('\n------------------------------------------------------------');
    console.log('Q' + String(r.q).padStart(2, '0') + (pass ? ' PASS' : ' FAIL') + ' (' + r.latency + 'ms)');
    console.log('  query      : ' + r.query);
    console.log('  answer     : ' + (r.answer ? snip(r.answer, 300) : 'null'));
    console.log('  grounded   : ' + r.grounded);
    console.log('  confidence : ' + r.confidence);
    console.log('  mode       : ' + r.mode);
    if (r.err) console.log('  err        : ' + r.err);
    console.log('  sources:');
    if (r.sources.length) { for (const s of r.sources) console.log('    - ' + snip(s, 140)); }
    else console.log('    (none)');
    console.log('  BM25 top10:');
    for (const s of r.bm25Top) console.log('    ' + snip(s, 140));
    console.log('  semantic top10:');
    for (const s of r.semTop) console.log('    ' + snip(s, 140));
  }

  const legitPassed = results.filter((r) => r.grounded).length;
  console.log('\n==================================================================');
  console.log('SUMMARY legitGrounded=' + legitPassed + '/22 (' + Math.round((legitPassed / 22) * 100) + '%)');
  console.log('FAILED_QUESTIONS: ' + (failed.length ? failed.join(', ') : 'none'));
  console.log('Average latency: ' + Math.round(totalLatency / results.length) + ' ms');
  console.log('==================================================================');
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });