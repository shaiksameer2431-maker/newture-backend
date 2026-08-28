import { findBestStrictAnswer } from '../src/services/knowledgeEngine.js';

const TEST_QUERIES = [
  { category: 'Courses', query: 'What B.Tech courses are offered at NECN?' },
  { category: 'Departments', query: 'What departments are available at Narayana Engineering College?' },
  { category: 'Admission', query: 'What is the admission procedure and eligibility for B.Tech?' },
  { category: 'Facilities', query: 'What facilities, library, and hostels are available on campus?' },
  { category: 'Placement', query: 'What are the placement statistics and top recruiting companies at NECN?' },
  { category: 'Academic Info', query: 'What academic information and examination schedules are available?' },
  { category: 'Career Counseling', query: 'What career development and counseling programs are offered?' },
  { category: 'Academic Regulations', query: 'What are the academic regulations for B.Tech students?' },
  { category: 'HOD', query: 'Who is the Head of Department for Mechanical Engineering?' },
  { category: 'Quantum Teleportation (Adversarial)', query: 'Does NECN offer a degree in Quantum Teleportation?' }
];

async function runCategoryTests() {
  console.log('=== RUNNING CATEGORY BENCHMARK TEST ===\n');

  for (const item of TEST_QUERIES) {
    const t0 = performance.now();
    const res = await findBestStrictAnswer(item.query, 'English');
    const elapsed = Math.round(performance.now() - t0);

    console.log(`--------------------------------------------------`);
    console.log(`Category:   ${item.category}`);
    console.log(`Query:      "${item.query}"`);
    console.log(`Latency:    ${elapsed} ms`);
    if (res) {
      console.log(`Grounded:   ${Boolean((res as any).grounded || (res as any).url)}`);
      console.log(`Confident:  ${res.isConfident}`);
      console.log(`Confidence: ${res.confidence}%`);
      console.log(`Source Page:${(res as any).pageTitle || res.source}`);
      console.log(`URL:        ${(res as any).url || 'N/A'}`);
      console.log(`Answer:     ${res.answer.slice(0, 180).replace(/\s+/g, ' ')}...`);
    } else {
      console.log(`Grounded:   false`);
      console.log(`Confident:  false`);
      console.log(`Answer:     [NOT FOUND / LOW CONFIDENCE]`);
    }
  }
  console.log(`--------------------------------------------------\n`);
}

runCategoryTests().catch(console.error);
