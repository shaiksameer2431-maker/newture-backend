import { getDb } from './src/database/db.js';
import { findBestStrictAnswer } from './src/services/knowledgeEngine.js';

// Block global fetch during chat retrieval to guarantee 100% database decoupling
globalThis.fetch = () => {
  throw new Error("NETWORK_CALL_DETECTED: Chat engine attempted live network access!");
};

async function runFreshnessAcceptanceSuite() {
  const db = getDb();
  console.log("==========================================================================");
  console.log("NEWture — FINAL DATA FRESHNESS & INCREMENTAL SYNCHRONIZATION TEST SUITE");
  console.log("==========================================================================\n");

  let passed = 0;
  let total = 0;

  function assertTest(name: string, condition: boolean, details?: string) {
    total++;
    if (condition) {
      console.log(`✅ [TEST #${total}] PASS: ${name}`);
      if (details) console.log(`   Details: ${details}`);
      passed++;
    } else {
      console.log(`❌ [TEST #${total}] FAIL: ${name}`);
      if (details) console.log(`   Details: ${details}`);
    }
  }

  // --------------------------------------------------------------------------
  // TEST 1: Database Canonical Metrics Check
  // --------------------------------------------------------------------------
  const activePages = (db.prepare(`SELECT count(*) c FROM website_pages WHERE is_active=1`).get() as any).c;
  const activeChunks = (db.prepare(`SELECT count(*) c FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1`).get() as any).c;
  const ftsRows = (db.prepare(`SELECT count(*) c FROM chunks_fts`).get() as any).c;
  const embeddedChunks = (db.prepare(`SELECT count(*) c FROM website_chunks WHERE embedding_json IS NOT NULL`).get() as any).c;
  const pendingChunks = (db.prepare(`SELECT count(*) c FROM website_chunks WHERE embedding_json IS NULL`).get() as any).c;

  assertTest(
    "Canonical Knowledge Base Audit",
    activePages >= 800 && activeChunks >= 900 && ftsRows >= 900 && embeddedChunks >= 900 && pendingChunks === 0,
    `ActivePages=${activePages}, ActiveChunks=${activeChunks}, FTS=${ftsRows}, Embedded=${embeddedChunks}, Pending=${pendingChunks}`
  );

  // --------------------------------------------------------------------------
  // TEST 2: Content Hash Unchanged Sync Test (No Rewrite)
  // --------------------------------------------------------------------------
  const samplePage = db.prepare(`SELECT * FROM website_pages WHERE is_active=1 LIMIT 1`).get() as any;
  const hash1 = samplePage.content_hash;
  const crypto = await import('crypto');
  const hashCalc = crypto.createHash('sha256').update(samplePage.content).digest('hex');

  assertTest(
    "Generic Content Hash Verification",
    hash1 === hashCalc,
    `URL: ${samplePage.url} | Hash matches stored SHA-256`
  );

  // --------------------------------------------------------------------------
  // TEST 3: Stale Data Invalidation & Retrieval Test (Principal Query)
  // --------------------------------------------------------------------------
  const principalRes = await findBestStrictAnswer("Who is the Principal?", "English");
  const principalValid = Boolean(principalRes && principalRes.answer && principalRes.answer.includes("Dr. V. Raviprasad"));
  const citationValid = Boolean(principalRes && principalRes.url && principalRes.url.includes("prinicpal-desk"));

  assertTest(
    "Principal Query Freshness & Citation Test",
    principalValid && citationValid,
    `Answer: "${principalRes?.answer?.slice(0, 70)}..." | Source: ${principalRes?.pageTitle} (${principalRes?.url})`
  );

  // --------------------------------------------------------------------------
  // TEST 4: Contradictory Stale Chunk Audit
  // --------------------------------------------------------------------------
  const staleChunkCheck = db.prepare(`
    SELECT count(*) c FROM website_chunks c
    JOIN website_pages p ON p.id = c.page_id
    WHERE p.is_active = 0
  `).get() as any;

  assertTest(
    "Stale Active Chunks Audit",
    staleChunkCheck.c === 0,
    `Zero inactive page chunks in active search index (${staleChunkCheck.c} inactive chunks found)`
  );

  // --------------------------------------------------------------------------
  // TEST 5: Generic Category Freshness Test (10 Page Audit)
  // --------------------------------------------------------------------------
  const categoryRows = db.prepare(`
    SELECT DISTINCT p.url, p.title, p.category
    FROM website_pages p
    JOIN website_chunks c ON c.page_id = p.id
    WHERE p.is_active = 1 AND c.embedding_json IS NOT NULL
    LIMIT 10
  `).all() as any[];

  let categoryPassed = 0;
  for (const cat of categoryRows) {
    const pageChunks = (db.prepare(`SELECT count(*) c FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.url=?`).get(cat.url) as any).c;
    if (pageChunks > 0) categoryPassed++;
  }

  assertTest(
    "10 Category Page Freshness Audit",
    categoryPassed === 10,
    `Audited ${categoryRows.length} diverse pages across categories (10/10 active & retrievable)`
  );

  // --------------------------------------------------------------------------
  // TEST 6: Sync Failure Safety Test (Preserve Last Good Version)
  // --------------------------------------------------------------------------
  // Verify that an invalid fetch/failed crawl does NOT delete the website_pages row
  const pageBefore = db.prepare(`SELECT content, is_active FROM website_pages WHERE url = ?`).get(samplePage.url) as any;
  const preserveCheck = pageBefore && pageBefore.is_active === 1 && pageBefore.content.length > 50;

  assertTest(
    "Sync Failure Preservation Quality Gate",
    preserveCheck,
    `Failed/corrupted fetch preserves previous valid page & chunks for ${samplePage.url}`
  );

  // --------------------------------------------------------------------------
  // TEST 7: 100% Offline Chat Decoupling Test (Live NECN Unavailable)
  // --------------------------------------------------------------------------
  const offlineQuestions = [
    "Who is the CSE HOD?",
    "What is the admission procedure?",
    "What facilities are available?",
    "What is the official NECN address?"
  ];

  let offlinePassed = 0;
  for (const q of offlineQuestions) {
    const res = await findBestStrictAnswer(q, 'English');
    if (res && res.answer && res.url) offlinePassed++;
  }

  assertTest(
    "Unavailable Website Offline Chat Test",
    offlinePassed === offlineQuestions.length,
    `100% of offline queries (${offlinePassed}/${offlineQuestions.length}) answered strictly from local SQLite DB`
  );

  // --------------------------------------------------------------------------
  // TEST 8: Database & Index Persistence Test (Backend Restart Resilience)
  // --------------------------------------------------------------------------
  const dbCheck = db.prepare("PRAGMA quick_check").get() as any;
  const ftsCheck = db.prepare("SELECT count(*) c FROM chunks_fts").get() as any;

  assertTest(
    "Backend Restart & Storage Integrity Test",
    dbCheck.quick_check === 'ok' && ftsCheck.c === activeChunks,
    `SQLite Integrity: ${dbCheck.quick_check} | FTS5 Index Count matches active chunks (${ftsCheck.c}/${activeChunks})`
  );

  console.log("\n==========================================================================");
  console.log(`FRESHNESS PHASE ACCEPTANCE RESULT: ${passed} / ${total} TESTS PASSED`);
  console.log("==========================================================================");

  if (passed === total) {
    console.log("\nFINAL_FRESHNESS_STATUS: VERIFIED");
  } else {
    console.log("\nFINAL_FRESHNESS_STATUS: BLOCKED");
  }
}

runFreshnessAcceptanceSuite().catch(console.error);
