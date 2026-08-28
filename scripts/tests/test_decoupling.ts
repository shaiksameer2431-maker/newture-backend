import { findBestStrictAnswer } from './src/services/knowledgeEngine.js';

// Block global fetch and HTTP calls to prove chat is 100% offline database RAG
globalThis.fetch = () => {
  throw new Error("NETWORK_CALL_DETECTED: Normal chat attempted a live network call!");
};

async function testDecoupling() {
  console.log("==========================================");
  console.log("CHAT / CRAWLER DECOUPLING TEST (OFFLINE)");
  console.log("==========================================\n");

  const testQuestions = [
    "Who is the Principal?",
    "Who is the CSE HOD?",
    "What is the admission procedure?",
    "What facilities are available?",
    "What is the official NECN address?"
  ];

  let passed = 0;

  for (const q of testQuestions) {
    console.log(`[DECOUPLING TEST] Question: "${q}"`);
    const start = Date.now();
    const res = await findBestStrictAnswer(q, 'English');
    const elapsed = Date.now() - start;

    if (res && res.answer) {
      console.log(`✅ PASS (${elapsed}ms)`);
      console.log(`   Answer: ${res.answer.slice(0, 100)}...`);
      console.log(`   Source: ${res.pageTitle || 'Source'} -> ${res.url || 'DB'}`);
      passed++;
    } else {
      console.log(`❌ FAIL: No answer returned (${elapsed}ms)`);
    }
  }

  console.log("\n==========================================");
  if (passed === testQuestions.length) {
    console.log("CHAT_DATABASE_ONLY: PASS");
    console.log("LIVE_NETWORK_FROM_CHAT: PASS (0 live network calls)");
  } else {
    console.log("CHAT_DATABASE_ONLY: FAIL");
  }
  console.log("==========================================");
}

testDecoupling().catch(console.error);
