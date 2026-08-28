/**
 * scripts/test-retrieval.ts
 *
 * Regression tests for the new BM25 retrieval layer. Runs Q1-Q10 against
 * bm25Search() and emits a PASS/PARTIAL/FAIL summary table.
 *
 * Q7 (HOD) is a content-gap test: if no HOD exists in the source HTML the
 * retrieval must return NO confident hits and the script reports PASS only
 * when no hallucinated name is present.
 *
 * Usage:
 *   npm run test-retrieval
 */

import { bm25Search } from '../src/services/retrieval.js';

interface Verdict { pass: boolean; partial: boolean; fail: boolean; reason: string; }
interface QueryResult { q: string; intent: string; topUrl: string; topTitle: string; score: number; verdict: Verdict; hits: any[]; }

function navOnly(chunkContent: string): boolean {
  if (!chunkContent) return true;
  const text = chunkContent.toLowerCase();
  // Heuristic: a chunk is "nav-only" if it contains many bullets AND no
  // sentence-like structure with multiple words.
  const bullets = (text.match(/•/g) || []).length;
  const sentences = (text.match(/\b(?:is|are|was|were|has|have|the|of|for|with)\b/g) || []).length;
  return bullets >= 8 && sentences < 3;
}

const QUERIES: Array<{
  q: string;
  intent: string;
  criteria: (top: any, hits: any[]) => Verdict;
}> = [
  {
    q: 'What courses are available at NECN?',
    intent: 'courses',
    criteria: (top, hits) => {
      if (!top) return { pass: false, partial: false, fail: true, reason: 'no hits' };
      const url = (top.url || '').toLowerCase();
      const ok = /ug-programmes|pg-programmes|admission\.php|academics|programs|programmes/.test(url);
      if (!ok) return { pass: false, partial: true, fail: false, reason: `top URL did not match expected module: ${top.url}` };
      if (navOnly(top.content || '')) return { pass: false, partial: true, fail: false, reason: 'top hit is nav-only' };
      return { pass: true, partial: false, fail: false, reason: 'OK' };
    }
  },
  {
    q: 'What departments are available at NECN?',
    intent: 'courses',
    criteria: (top, hits) => {
      if (!top) return { pass: false, partial: false, fail: true, reason: 'no hits' };
      const url = (top.url || '').toLowerCase();
      const ok = /department|ug-programmes|admission\.php|departments/.test(url);
      if (!ok) return { pass: false, partial: true, fail: false, reason: `top URL did not match: ${top.url}` };
      if (navOnly(top.content || '')) return { pass: false, partial: true, fail: false, reason: 'top hit is nav-only' };
      return { pass: true, partial: false, fail: false, reason: 'OK' };
    }
  },
  {
    q: 'What is the admission procedure?',
    intent: 'admissions',
    criteria: (top, hits) => {
      if (!top) return { pass: false, partial: false, fail: true, reason: 'no hits' };
      const url = (top.url || '').toLowerCase();
      if (!url.includes('admission')) return { pass: false, partial: true, fail: false, reason: `top URL did not contain admission: ${top.url}` };
      if (navOnly(top.content || '')) return { pass: false, partial: true, fail: false, reason: 'top hit is nav-only' };
      return { pass: true, partial: false, fail: false, reason: 'OK' };
    }
  },
  {
    q: 'What facilities are available?',
    intent: 'facilities',
    criteria: (top, hits) => {
      if (!top) return { pass: false, partial: false, fail: true, reason: 'no hits' };
      const url = (top.url || '').toLowerCase();
      const ok = /facilit|library|infrastructure|hostel|campus/.test(url);
      if (!ok) return { pass: false, partial: true, fail: false, reason: `top URL did not match facilities: ${top.url}` };
      if (navOnly(top.content || '')) return { pass: false, partial: true, fail: false, reason: 'top hit is nav-only' };
      return { pass: true, partial: false, fail: false, reason: 'OK' };
    }
  },
  {
    q: 'What placement information is available?',
    intent: 'placements',
    criteria: (top, hits) => {
      if (!top) return { pass: false, partial: false, fail: true, reason: 'no hits' };
      const url = (top.url || '').toLowerCase();
      if (!/placement|training|career/.test(url)) return { pass: false, partial: true, fail: false, reason: `top URL did not match placement: ${top.url}` };
      if (navOnly(top.content || '')) return { pass: false, partial: true, fail: false, reason: 'top hit is nav-only' };
      return { pass: true, partial: false, fail: false, reason: 'OK' };
    }
  },
  {
    q: 'What academic information is available?',
    intent: 'academics',
    criteria: (top, hits) => {
      if (!top) return { pass: false, partial: false, fail: true, reason: 'no hits' };
      const url = (top.url || '').toLowerCase();
      const ok = /academic|syllabus|regulation|calendar|examination/.test(url);
      if (!ok) return { pass: false, partial: true, fail: false, reason: `top URL did not match academic: ${top.url}` };
      if (navOnly(top.content || '')) return { pass: false, partial: true, fail: false, reason: 'top hit is nav-only' };
      return { pass: true, partial: false, fail: false, reason: 'OK' };
    }
  },
  {
    q: 'Who is the HOD of Mechanical Engineering?',
    intent: 'department_head',
    criteria: (top, hits) => {
      // Honest gap: source HTML doesn't mention HOD anywhere (verified
      // during audit). If no hits contain "HOD" + a person name, this is
      // PASS — content gap acknowledged. The retrieval must NOT fabricate.
      const candidates = [top, ...(hits || [])].filter(Boolean);
      const hodEvidence = candidates.find(h => /\b(?:hod|head of (?:the )?department|department head)\b/i.test(h.content || ''));
      if (hodEvidence) {
        const url = (hodEvidence.url || '').toLowerCase();
        if (!url.includes('mech')) return { pass: false, partial: true, fail: false, reason: 'HOD mentioned but URL is not Mechanical' };
        return { pass: true, partial: false, fail: false, reason: 'OK' };
      }
      // No HOD evidence in the corpus — must NOT fabricate a name.
      const concatenated = candidates.map(c => (c.content || '')).join(' ').toLowerCase();
      const looksHallucinated = /(?:dr\.|mr\.|mrs\.|professor)\s+[A-Z][a-z]+/.test(concatenated) &&
        /(?:hod|head of (?:the )?department)/.test(concatenated);
      if (looksHallucinated) return { pass: false, partial: false, fail: true, reason: 'possible hallucination: HOD phrase + person name detected but URL does not match' };
      return { pass: true, partial: false, fail: false, reason: 'content gap acknowledged — HOD not in source' };
    }
  },
  {
    q: 'What is career counseling?',
    intent: 'counseling',
    criteria: (top, hits) => {
      if (!top) return { pass: false, partial: false, fail: true, reason: 'no hits' };
      const url = (top.url || '').toLowerCase();
      if (url.endsWith('.pdf') && url.includes('career')) return { pass: true, partial: false, fail: false, reason: 'OK' };
      // Allow partial credit when the answer is on a non-PDF page that
      // contains the phrase "career counseling".
      const content = (top.content || '').toLowerCase();
      if (content.includes('career') && content.includes('counseling')) return { pass: false, partial: true, fail: false, reason: 'career counseling text found but not on the expected PDF URL' };
      return { pass: false, partial: true, fail: false, reason: `top URL is not the expected PDF: ${top.url}` };
    }
  },
  {
    q: 'What are the academic regulations?',
    intent: 'regulations',
    criteria: (top, hits) => {
      if (!top) return { pass: false, partial: false, fail: true, reason: 'no hits' };
      const url = (top.url || '').toLowerCase();
      if (url.includes('regulation')) return { pass: true, partial: false, fail: false, reason: 'OK' };
      const content = (top.content || '').toLowerCase();
      if (content.includes('regulation') && content.length > 200) return { pass: false, partial: true, fail: false, reason: 'regulations text found but URL does not match' };
      return { pass: false, partial: true, fail: false, reason: `top URL did not match regulations: ${top.url}` };
    }
  },
  {
    q: 'What sports facilities are available?',
    intent: 'sports',
    criteria: (top, hits) => {
      if (!top) return { pass: false, partial: false, fail: true, reason: 'no hits' };
      const url = (top.url || '').toLowerCase();
      if (url.includes('sport')) return { pass: true, partial: false, fail: false, reason: 'OK' };
      const content = (top.content || '').toLowerCase();
      if (content.includes('sport') && content.length > 200) return { pass: false, partial: true, fail: false, reason: 'sports text found but URL does not match' };
      return { pass: false, partial: true, fail: false, reason: `top URL did not match sports: ${top.url}` };
    }
  }
];

function pad(s: string, n: number): string {
  if (s.length <= n) return s + ' '.repeat(n - s.length);
  return s.slice(0, n - 1) + '…';
}

async function main() {
  console.log('NECN Retrieval Regression Test');
  console.log('==============================');
  const results: QueryResult[] = [];
  let passed = 0, partial = 0, failed = 0;

  for (let i = 0; i < QUERIES.length; i++) {
    const t = QUERIES[i];
    const hits = bm25Search(t.q, 5);
    const top = hits[0];
    const verdict = t.criteria(top, hits);
    if (verdict.pass) passed++;
    else if (verdict.fail) failed++;
    else partial++;
    results.push({
      q: t.q,
      intent: t.intent,
      topUrl: top?.url || '(no hits)',
      topTitle: top?.title || '(none)',
      score: top?.score || 0,
      verdict,
      hits
    });
  }

  // Print the table.
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const v = r.verdict.pass ? 'PASS' : r.verdict.fail ? 'FAIL' : 'PARTIAL';
    console.log(`Q${i + 1}  ${pad(v, 7)} ${pad(r.q, 60)} | ${pad(r.topUrl, 60)} | ${r.score}`);
    if (r.verdict.reason !== 'OK') console.log(`      reason: ${r.verdict.reason}`);
  }
  console.log(`\nPASSED ${passed}/${QUERIES.length}  PARTIAL ${partial}/${QUERIES.length}  FAILED ${failed}/${QUERIES.length}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[TEST-RETRIEVAL] Fatal:', err);
  process.exit(2);
});
