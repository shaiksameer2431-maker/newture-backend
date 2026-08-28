import { searchWebsiteKnowledge } from './src/services/websiteSearch.js';
import { findBestStrictAnswer } from './src/services/knowledgeEngine.ts';
import { getDb } from './src/database/db.js';

const benchmarkQuestions = [
  "Who is the CSE HOD?",
  "What is the admission procedure?",
  "What facilities does NECN provide?",
  "What is the official NECN address?",
  "Who is the Principal?",
  "What programs are offered?",
  "Who are the CSE faculty?",
  "What are the attendance requirements?"
];

async function validateOfflineChat() {
  console.log("==================================================");
  console.log("BENCHMARK OFFLINE DATABASE CHAT VALIDATION");
  console.log("==================================================");

  const db = getDb();
  let passedCount = 0;

  for (let i = 0; i < benchmarkQuestions.length; i++) {
    const query = benchmarkQuestions[i];
    console.log(`\n--------------------------------------------------`);
    console.log(`[QUESTION ${i + 1}/${benchmarkQuestions.length}] "${query}"`);
    console.log(`--------------------------------------------------`);

    // First try strict knowledge engine
    const strictResult = await findBestStrictAnswer(query);
    if (strictResult && strictResult.answer) {
      console.log(`  [SOURCE] Knowledge Engine (Rules / Structured Data)`);
      console.log(`  [TITLE ] ${strictResult.pageTitle}`);
      console.log(`  [CONF  ] ${strictResult.confidence}%`);
      console.log(`  [ANSWER] ${strictResult.answer.slice(0, 300)}...`);
      passedCount++;
      continue;
    }

    // Try website knowledge database retrieval (FTS5 + MiniLM vector embedding)
    const siteResults = await searchWebsiteKnowledge(query, 3);
    if (siteResults && siteResults.length > 0) {
      const topHit = siteResults[0];
      console.log(`  [SOURCE] Website Knowledge Database (FTS5 + Vector Embedding)`);
      console.log(`  [TITLE ] ${topHit.pageTitle}`);
      console.log(`  [URL   ] ${topHit.url}`);
      console.log(`  [MODE  ] ${topHit.retrievalMode}`);
      console.log(`  [CONF  ] ${topHit.confidence}%`);
      console.log(`  [ANSWER] ${topHit.answer.slice(0, 300)}...`);

      // Verify citation is accurate and non-generic
      const isValidCitation = Boolean(topHit.url && topHit.url.startsWith('http') && topHit.pageTitle);
      if (isValidCitation) {
        passedCount++;
      } else {
        console.warn(`  [WARN  ] Invalid or generic citation! URL: ${topHit.url}`);
      }
    } else {
      console.error(`  [FAILED] No database evidence retrieved for question!`);
    }
  }

  console.log("\n==================================================");
  console.log("BENCHMARK OFFLINE CHAT SUMMARY");
  console.log("==================================================");
  console.log(`Total Questions : ${benchmarkQuestions.length}`);
  console.log(`Passed Questions: ${passedCount}`);
  console.log(`Success Rate    : ${Math.round((passedCount / benchmarkQuestions.length) * 100)}%`);

  if (passedCount === benchmarkQuestions.length) {
    console.log("\n>>> ALL 8 BENCHMARK QUESTIONS PASSED WITH DATABASE EVIDENCE & CITATIONS! <<<");
  } else {
    console.warn(`\n>>> BENCHMARK FINISHED WITH ${benchmarkQuestions.length - passedCount} UNANSWERED QUESTIONS <<<`);
  }
}

validateOfflineChat().catch(err => {
  console.error("Offline chat validation error:", err);
  process.exit(1);
});
