import { findBestStrictAnswer } from '../src/services/knowledgeEngine.js';

interface TestCase {
  id: number;
  category: string;
  query: string;
  expectedKeywords: string[];
  forbiddenKeywords?: string[];
  expectedUrlPattern?: string;
}

const TEST_SUITE: TestCase[] = [
  // 1. Department HODs (Individual & Paraphrases)
  { id: 1, category: "HOD", query: "Who is the CSE HOD?", expectedKeywords: ["Dr. C. Rajendra", "CSE"], forbiddenKeywords: ["I couldn't find", "##H4##", "##TR##"] },
  { id: 2, category: "HOD", query: "Who heads CSE?", expectedKeywords: ["Dr. C. Rajendra"], forbiddenKeywords: ["I couldn't find"] },
  { id: 3, category: "HOD", query: "Who is the ECE HOD?", expectedKeywords: ["Dr. K. Murali"], forbiddenKeywords: ["Dr. C. Rajendra", "I couldn't find"] },
  { id: 4, category: "HOD", query: "Who is the EEE HOD?", expectedKeywords: ["Dr. G. Venkateswarlu"], forbiddenKeywords: ["I couldn't find"] },
  { id: 5, category: "HOD", query: "Who is the Civil HOD?", expectedKeywords: ["Dr. K. Yugandhara Reddy"], forbiddenKeywords: ["I couldn't find"] },
  { id: 6, category: "HOD", query: "Who is the Mechanical HOD?", expectedKeywords: ["Dr. B. V. Krishnaiah"], forbiddenKeywords: ["I couldn't find"] },
  { id: 7, category: "HOD", query: "Who heads Mechanical?", expectedKeywords: ["Dr. B. V. Krishnaiah"], forbiddenKeywords: ["I couldn't find"] },
  { id: 8, category: "HOD", query: "Who is the MCA HOD?", expectedKeywords: ["Dr. A. V. S. S. Subba Rao"], forbiddenKeywords: ["I couldn't find"] },
  { id: 9, category: "HOD", query: "Who is the MBA HOD?", expectedKeywords: ["Dr. V. V. Giri"], forbiddenKeywords: ["I couldn't find"] },
  
  // 2. Department Heads List
  { id: 10, category: "HOD List", query: "Who are the department heads?", expectedKeywords: ["Dr. C. Rajendra", "Dr. K. Murali", "Dr. B. V. Krishnaiah"], forbiddenKeywords: ["I couldn't find"] },
  { id: 11, category: "HOD List", query: "Who are the HODs?", expectedKeywords: ["Dr. C. Rajendra", "Dr. K. Murali"], forbiddenKeywords: ["I couldn't find"] },

  // 3. Admissions Queries
  { id: 12, category: "Admissions", query: "What is the admission procedure?", expectedKeywords: ["APSCHE", "EAPCET"], expectedUrlPattern: "admission.php" },
  { id: 13, category: "Admissions", query: "How can I get admission?", expectedKeywords: ["Category A", "EAPCET"], expectedUrlPattern: "admission.php" },
  { id: 14, category: "Admissions", query: "Who can I contact for admissions?", expectedKeywords: ["Admissions Cell", "0861-2313842"], forbiddenKeywords: ["I couldn't find"] },
  { id: 15, category: "Admissions", query: "Who handles admissions?", expectedKeywords: ["Admissions"], forbiddenKeywords: ["I couldn't find"] },
  { id: 16, category: "Admissions", query: "What documents are required?", expectedKeywords: ["SSC", "Intermediate", "EAPCET"], forbiddenKeywords: ["I couldn't find"] },

  // 4. Principal & Core Facts
  { id: 17, category: "Principal", query: "Who is the Principal?", expectedKeywords: ["Dr. V. Raviprasad"], expectedUrlPattern: "prinicpal-desk.php" },
  { id: 18, category: "Contact", query: "What is the CSE department email?", expectedKeywords: ["hodcse@necn.ac.in"], forbiddenKeywords: ["I couldn't find"] },
  { id: 19, category: "Address", query: "What is the official NECN address?", expectedKeywords: ["Narayana Avenue", "Muthukur Road", "Nellore"], forbiddenKeywords: ["I couldn't find"] },
  { id: 20, category: "Facilities", query: "What facilities does NECN provide?", expectedKeywords: ["Central Library", "Auditoriums", "Hostels"], forbiddenKeywords: ["I couldn't find"] },

  // 5. 20 NEW UNSEEN NATURAL LANGUAGE TEST QUESTIONS
  { id: 21, category: "Unseen", query: "Where is Narayana Engineering College located?", expectedKeywords: ["Narayana Avenue", "Muthukur Road", "Nellore"] },
  { id: 22, category: "Unseen", query: "How to contact the college for B.Tech admissions enquiry?", expectedKeywords: ["0861-2313842", "admissions@necn.ac.in"] },
  { id: 23, category: "Unseen", query: "Can you list the sports amenities available on campus?", expectedKeywords: ["Cricket", "Volleyball", "Gymnasium"] },
  { id: 24, category: "Unseen", query: "What books and journals are available in the Central Library?", expectedKeywords: ["Central Library", "30,000", "journals"] },
  { id: 25, category: "Unseen", query: "Does NECN operate college bus transport for students?", expectedKeywords: ["buses", "transportation"] },
  { id: 26, category: "Unseen", query: "What are the attendance requirements to write semester exams?", expectedKeywords: ["75%"] },
  { id: 27, category: "Unseen", query: "Who is leading the Electrical and Electronics Engineering department?", expectedKeywords: ["Dr. G. Venkateswarlu"] },
  { id: 28, category: "Unseen", query: "What courses and degrees are offered at Narayana Engineering College?", expectedKeywords: ["B.Tech", "M.Tech", "MBA", "MCA"] },
  { id: 29, category: "Unseen", query: "What is the contact email address for admissions?", expectedKeywords: ["admissions@necn.ac.in"] },
  { id: 30, category: "Unseen", query: "Who is the Head of Civil Engineering?", expectedKeywords: ["Dr. K. Yugandhara Reddy"] },
  { id: 31, category: "Unseen", query: "What documents should I bring for college admission registration?", expectedKeywords: ["SSC", "Intermediate", "Transfer Certificate"] },
  { id: 32, category: "Unseen", query: "Who is the HOD for Master of Business Administration?", expectedKeywords: ["Dr. V. V. Giri"] },
  { id: 33, category: "Unseen", query: "Is hostel facility provided for boys and girls?", expectedKeywords: ["Hostels"] },
  { id: 34, category: "Unseen", query: "What entrance exams are accepted for B.Tech category A seats?", expectedKeywords: ["EAPCET"] },
  { id: 35, category: "Unseen", query: "Who is the HOD for MCA department?", expectedKeywords: ["Dr. A. V. S. S. Subba Rao"] },
  { id: 36, category: "Unseen", query: "What is the phone number of the CSE department?", expectedKeywords: ["0861-2313842"] },
  { id: 37, category: "Unseen", query: "What academic regulations does NECN follow as an autonomous college?", expectedKeywords: ["JNTUA", "R20"] },
  { id: 38, category: "Unseen", query: "Who is the head of mechanical engineering department?", expectedKeywords: ["Dr. B. V. Krishnaiah"] },
  { id: 39, category: "Unseen", query: "Who is the head of institution at NECN?", expectedKeywords: ["Dr. V. Raviprasad"] },
  { id: 40, category: "Unseen", query: "What are the vision and mission of the computer science department?", expectedKeywords: ["Vision", "premier departments"] }
];

async function runAcceptanceSuite() {
  console.log("==========================================================================");
  console.log("STARTING FULL ACCEPTANCE TEST SUITE (40 TEST CASES)");
  console.log("==========================================================================\n");

  let passed = 0;
  let failed = 0;

  for (const tc of TEST_SUITE) {
    console.log(`[TEST #${tc.id}] [${tc.category}] "${tc.query}"`);
    const start = Date.now();
    const result = await findBestStrictAnswer(tc.query, 'English');
    const elapsed = Date.now() - start;

    if (!result || !result.answer) {
      console.log(`❌ FAIL (No answer returned) [${elapsed}ms]`);
      failed++;
      continue;
    }

    const ans = result.answer;
    const sources = result.sources || [];
    const url = result.url || (sources[0]?.url) || '';

    // Check evidence markers
    const hasInternalMarkers = /##H\d##|##TR##|OFFICIAL NECN EVIDENCE|chunkId|databaseID|\[Source\s*\d+\]/i.test(ans);
    if (hasInternalMarkers) {
      console.log(`❌ FAIL (Contains internal evidence markers) [${elapsed}ms]`);
      console.log(`   Answer: ${ans.slice(0, 150)}...`);
      failed++;
      continue;
    }

    // Check expected keywords
    const missingKeywords = tc.expectedKeywords.filter(kw => !ans.toLowerCase().includes(kw.toLowerCase()));
    if (missingKeywords.length > 0) {
      console.log(`❌ FAIL (Missing expected keywords: ${missingKeywords.join(', ')}) [${elapsed}ms]`);
      console.log(`   Answer: ${ans}`);
      failed++;
      continue;
    }

    // Check forbidden keywords
    const foundForbidden = (tc.forbiddenKeywords || []).filter(kw => ans.toLowerCase().includes(kw.toLowerCase()));
    if (foundForbidden.length > 0) {
      console.log(`❌ FAIL (Found forbidden keywords: ${foundForbidden.join(', ')}) [${elapsed}ms]`);
      console.log(`   Answer: ${ans}`);
      failed++;
      continue;
    }

    // Check URL pattern if specified
    if (tc.expectedUrlPattern && !url.toLowerCase().includes(tc.expectedUrlPattern.toLowerCase())) {
      console.log(`❌ FAIL (Source URL '${url}' does not match pattern '${tc.expectedUrlPattern}') [${elapsed}ms]`);
      failed++;
      continue;
    }

    console.log(`✅ PASS (${elapsed}ms)`);
    console.log(`   Answer: ${ans.slice(0, 120)}...`);
    console.log(`   Source: ${result.pageTitle || sources[0]?.title || 'Page'} -> ${url}`);
    passed++;
  }

  console.log("\n==========================================================================");
  console.log(`ACCEPTANCE TEST RESULTS: PASSED=${passed} / FAILED=${failed} / TOTAL=${TEST_SUITE.length}`);
  console.log("==========================================================================");

  if (failed === 0) {
    console.log("\nANSWER_PIPELINE_STATUS=VERIFIED");
  } else {
    console.log("\nANSWER_PIPELINE_STATUS=FAILED");
  }
}

runAcceptanceSuite().catch(err => console.error("Test Suite Execution Error:", err));
