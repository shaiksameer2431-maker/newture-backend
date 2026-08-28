import { findBestStrictAnswer } from './src/services/knowledgeEngine.js';

interface TestCase {
  category: string;
  query: string;
  expectedKeywords?: string[];
  expectSafeNotFound?: boolean;
  expectClarification?: boolean;
}

const TEST_CASES: TestCase[] = [
  // 1. Organizational
  { category: 'Organizational', query: 'Who is the Principal?', expectedKeywords: ['Venkateswarlu', 'Raviprasad', 'Principal'] },
  { category: 'Organizational', query: 'Who is the CSE HOD?', expectedKeywords: ['Rajendra', 'CSE', 'HOD'] },
  { category: 'Organizational', query: 'Who is the ECE HOD?', expectedKeywords: ['Murali', 'ECE', 'HOD'] },
  { category: 'Organizational', query: 'Who are the department heads?', expectedKeywords: ['HOD', 'Civil', 'Computer Science', 'Electronics'] },

  // 2. Admissions
  { category: 'Admissions', query: 'What is the admission procedure?', expectedKeywords: ['APSCHE', 'admission', 'Lateral Entry', 'Category'] },
  { category: 'Admissions', query: 'How do I apply for admission?', expectedKeywords: ['APSCHE', 'counseling', 'EAPCET', 'Category'] },
  { category: 'Admissions', query: 'What are the admission requirements?', expectedKeywords: ['Intermediate', 'EAPCET', 'marks', 'eligibility'] },
  { category: 'Admissions', query: 'What documents are required for admission?', expectedKeywords: ['SSC', 'Intermediate', 'Transfer Certificate', 'Hall Ticket', 'Aadhaar'] },
  { category: 'Admissions', query: 'What is the B.Tech admission process?', expectedKeywords: ['B.Tech', 'EAPCET', 'Category A', 'Category B'] },

  // 3. Academic
  { category: 'Academic', query: 'What programs are offered?', expectedKeywords: ['B.Tech', 'M.Tech', 'MBA', 'MCA'] },
  { category: 'Academic', query: 'What courses does CSE offer?', expectedKeywords: ['CSE', 'Computer Science', 'B.Tech', 'CSM'] },
  { category: 'Academic', query: 'Who are the CSE faculty?', expectedKeywords: ['CSE', 'Rajendra', 'Professors', 'Faculty'] },
  { category: 'Academic', query: 'What is the CSE vision?', expectedKeywords: ['Vision', 'Technical', 'Education', 'Engineers'] },
  { category: 'Academic', query: 'What is the CSE mission?', expectedKeywords: ['Mission', 'quality education', 'research', 'labs'] },

  // 4. Facilities
  { category: 'Facilities', query: 'What facilities does NECN provide?', expectedKeywords: ['Library', 'Auditorium', 'Sports', 'Gym', 'Hostel'] },
  { category: 'Facilities', query: 'Does NECN have a library?', expectedKeywords: ['Library', 'books', 'journals', 'e-learning'] },
  { category: 'Facilities', query: 'What sports facilities are available?', expectedKeywords: ['Cricket', 'Volleyball', 'Basketball', 'Gym', 'Sports'] },
  { category: 'Facilities', query: 'Is transport available?', expectedKeywords: ['Transport', 'buses', 'Nellore', 'vehicle'] },

  // 5. Contact
  { category: 'Contact', query: 'What is the official NECN address?', expectedKeywords: ['Nellore', 'Muthukur Road', 'Andhra Pradesh'] },
  { category: 'Contact', query: 'What is the CSE department email?', expectedKeywords: ['hodcse@necn.ac.in', 'email', 'couldn\'t verify'] },
  { category: 'Contact', query: 'What is the CSE department phone number?', expectedKeywords: ['0861', '9392901051', 'phone', 'contact'] },

  // 6. Rules / Policies
  { category: 'Rules/Policies', query: 'What are the attendance requirements?', expectedKeywords: ['75%', 'attendance', 'Condonation', 'medical'] },
  { category: 'Rules/Policies', query: 'What are the examination regulations?', expectedKeywords: ['Academic Regulations', 'Autonomous', 'JNTUA', 'evaluation'] },

  // 7. Temporal Safety
  { category: 'Temporal', query: 'Who is the current CSE HOD?', expectedKeywords: ['Rajendra', 'CSE', 'HOD'] },
  { category: 'Temporal', query: 'Who was the CSE HOD in 1990?', expectSafeNotFound: true },
  { category: 'Temporal', query: 'Who will be the CSE HOD in 2040?', expectSafeNotFound: true },

  // 8. Ambiguity
  { category: 'Ambiguity', query: 'Who is the HOD?', expectClarification: true },
  { category: 'Ambiguity', query: 'What is the phone number?', expectClarification: true },
  { category: 'Ambiguity', query: 'What courses are available?', expectClarification: true },

  // 9. Paraphrases
  { category: 'Paraphrases', query: 'Who heads CSE?', expectedKeywords: ['Rajendra', 'CSE', 'HOD'] },
  { category: 'Paraphrases', query: 'Who leads the CSE department?', expectedKeywords: ['Rajendra', 'CSE'] },
  { category: 'Paraphrases', query: 'Tell me the current head of CSE.', expectedKeywords: ['Rajendra', 'CSE'] },
  { category: 'Paraphrases', query: 'How can I get admission?', expectedKeywords: ['APSCHE', 'EAPCET', 'admission'] },
  { category: 'Paraphrases', query: "What's the college address?", expectedKeywords: ['Nellore', 'Muthukur Road'] },

  // 10. Multi-part / Multi-entity / Multi-attribute
  { category: 'Multi-part', query: 'Who is the CSE HOD and what is the CSE email?', expectedKeywords: ['Rajendra'] },
  { category: 'Multi-part', query: 'Who are the CSE and ECE HODs?', expectedKeywords: ['Rajendra', 'Murali'] },
  { category: 'Multi-part', query: 'What are the CSE courses and who teaches them?', expectedKeywords: ['CSE', 'Computer Science'] }
];

const SAFE_NOT_FOUND_MSG = "I couldn't verify that information from the available official NECN sources.";

async function runBenchmark() {
  console.log("==================================================");
  console.log("GENERIC EXACT-GROUNDED CHATBOT SUITE");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;
  const results: any[] = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    console.log(`\n--------------------------------------------------`);
    console.log(`[TEST ${i + 1}/${TEST_CASES.length}] [${tc.category}] "${tc.query}"`);
    console.log(`--------------------------------------------------`);

    const res = await findBestStrictAnswer(tc.query, 'English');
    const answerText = res ? res.answer : SAFE_NOT_FOUND_MSG;
    const url = (res as any)?.url || (res as any)?.sources?.[0]?.url || 'N/A';
    const isSafeNotFound = answerText.includes("couldn't verify") || !res;
    const isClarification = answerText.includes("Which department") || answerText.includes("asking about");

    let isTestPass = false;

    if (tc.expectSafeNotFound) {
      isTestPass = isSafeNotFound;
    } else if (tc.expectClarification) {
      isTestPass = isClarification || answerText.includes("Which department");
    } else if (tc.expectedKeywords && tc.expectedKeywords.length > 0) {
      // Check if at least some required keywords appear
      const matched = tc.expectedKeywords.filter(kw => answerText.toLowerCase().includes(kw.toLowerCase()));
      isTestPass = matched.length > 0 && !isSafeNotFound;
    } else {
      isTestPass = Boolean(res && res.answer);
    }

    if (isTestPass) {
      passed++;
      console.log(`  [STATUS] PASS`);
    } else {
      failed++;
      console.log(`  [STATUS] FAIL`);
    }

    console.log(`  [ANSWER] ${answerText.slice(0, 150)}...`);
    console.log(`  [SOURCE] ${url}`);

    results.push({
      id: i + 1,
      category: tc.category,
      query: tc.query,
      status: isTestPass ? 'PASS' : 'FAIL',
      answer: answerText.slice(0, 100),
      sourceUrl: url
    });
  }

  console.log("\n==================================================");
  console.log("GENERIC CHATBOT BENCHMARK SUMMARY");
  console.log("==================================================");
  console.log(`Total Test Cases : ${TEST_CASES.length}`);
  console.log(`Passed          : ${passed}`);
  console.log(`Failed          : ${failed}`);
  console.log(`Success Rate    : ${Math.round((passed / TEST_CASES.length) * 100)}%`);

  if (failed === 0) {
    console.log("\n>>> ANSWER_PIPELINE_STATUS=VERIFIED <<<");
  } else {
    console.log(`\n>>> ANSWER_PIPELINE_STATUS=BLOCKED (${failed} failures) <<<`);
  }
}

runBenchmark().catch(err => {
  console.error("Benchmark crashed:", err);
  process.exit(1);
});
