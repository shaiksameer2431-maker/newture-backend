import { findBestStrictAnswer } from './src/services/knowledgeEngine.js';

// Block live fetch calls to enforce 100% database RAG
globalThis.fetch = () => {
  throw new Error("NETWORK_CALL_DETECTED: Normal chat attempted a live network call!");
};

const NEW_30_QUESTIONS = [
  "What is the objective of the Research and Development Cell at NECN?",
  "Who is on the Governing Body of Narayana Engineering College?",
  "What is the role of the Internal Complaints Committee (ICC)?",
  "What scholarships or financial assistance are available for students?",
  "How does the IQAC maintain academic quality standards?",
  "What are the anti-ragging guidelines and penalties at NECN?",
  "Where can alumni register for the college alumni association?",
  "What career guidance activities are conducted by the placement cell?",
  "What facilities are available in the college gymnasium?",
  "What are the aims and objectives of physical education?",
  "What certificate courses are offered to students?",
  "What is the function of the Industry Institute Interaction Cell?",
  "Where is the college canteen located on campus?",
  "What are the rules regarding campus security and surveillance?",
  "Does NECN have a robotics club or student technical association?",
  "What is the procedure for obtaining a Transfer Certificate (TC)?",
  "How are semester end examinations conducted under autonomous regulations?",
  "What facilities are provided in the boys and girls hostels?",
  "What is the role of the Women Empowerment Forum?",
  "What NSS and YRC community service activities take place at NECN?",
  "What value added courses are available for engineering students?",
  "How can students submit feedback on curriculum and facilities?",
  "What is the eligibility for lateral entry admission into 2nd year B.Tech?",
  "What ICET rank is required for MCA or MBA category A seats?",
  "What print and online journals does the library subscribe to?",
  "Are there indoor games facilities available for students?",
  "What is the official contact address of the Anti-Ragging Committee?",
  "What academic calendar regulations apply to undergraduate B.Tech?",
  "Where is the campus located in Nellore district?",
  "Who is the Principal of Narayana Engineering College, Nellore?"
];

async function run30NewQuestionsTest() {
  console.log("==========================================================================");
  console.log("30 NEW UNSEEN QUESTION GENERALIZATION TEST (100% OFFLINE DB RAG)");
  console.log("==========================================================================\n");

  let passed = 0;

  for (let i = 0; i < NEW_30_QUESTIONS.length; i++) {
    const q = NEW_30_QUESTIONS[i];
    console.log(`[UNSEEN QUERY #${i + 1}] "${q}"`);
    const start = Date.now();
    const res = await findBestStrictAnswer(q, 'English');
    const elapsed = Date.now() - start;

    if (!res || !res.answer) {
      console.log(`❌ FAIL: No response returned (${elapsed}ms)`);
      continue;
    }

    const hasInternalMarkers = /##H\d##|##TR##|OFFICIAL NECN EVIDENCE|chunkId|databaseID/i.test(res.answer);
    if (hasInternalMarkers) {
      console.log(`❌ FAIL: Contains raw parser artifacts (${elapsed}ms)`);
      continue;
    }

    console.log(`✅ PASS (${elapsed}ms)`);
    console.log(`   Answer: ${res.answer.slice(0, 110)}...`);
    console.log(`   Citation: ${res.pageTitle || 'Official Source'} -> ${res.url || 'Database'}`);
    passed++;
  }

  console.log("\n==========================================================================");
  console.log(`UNSEEN QUERY GENERALIZATION RESULT: ${passed} / ${NEW_30_QUESTIONS.length} PASSED`);
  console.log("==========================================================================");
}

run30NewQuestionsTest().catch(console.error);
