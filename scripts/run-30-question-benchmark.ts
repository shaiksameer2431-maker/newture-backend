import { findBestStrictAnswer } from '../src/services/knowledgeEngine.js';

interface QuestionItem { id: number; category: string; query: string; expectedGrounded: boolean; }

const BENCHMARK_QUESTIONS: QuestionItem[] = [
  { id: 1,  category: 'Courses',         query: 'What B.Tech programs and courses are available at Narayana Engineering College Nellore?', expectedGrounded: true },
  { id: 2,  category: 'Departments',     query: 'What engineering departments exist at NECN?', expectedGrounded: true },
  { id: 3,  category: 'Departments',     query: 'Tell me about the Computer Science and Engineering CSE department.', expectedGrounded: true },
  { id: 4,  category: 'Departments',     query: 'Tell me about the Mechanical Engineering department.', expectedGrounded: true },
  { id: 5,  category: 'Admissions',      query: 'What is the admission procedure and eligibility criteria for B.Tech?', expectedGrounded: true },
  { id: 6,  category: 'Admissions',      query: 'What details are available about college fees and admission requirements?', expectedGrounded: true },
  { id: 7,  category: 'HOD',             query: 'Who is the Head of Department HOD for Mechanical Engineering?', expectedGrounded: true },
  { id: 8,  category: 'HOD',             query: 'Who is the Principal of Narayana Engineering College Nellore?', expectedGrounded: true },
  { id: 9,  category: 'Facilities',      query: 'What library facilities and central library resources are available?', expectedGrounded: true },
  { id: 10, category: 'Facilities',      query: 'What campus infrastructure, hostel, and canteen facilities exist?', expectedGrounded: true },
  { id: 11, category: 'Placements',      query: 'What are the placement statistics and top recruiting companies at NECN?', expectedGrounded: true },
  { id: 12, category: 'Placements',      query: 'Tell me about the Mega Job Mela organized at the college.', expectedGrounded: true },
  { id: 13, category: 'Career',          query: 'What career development programs and guidance cell services are offered?', expectedGrounded: true },
  { id: 14, category: 'Counseling',      query: 'What student counseling and guidance programs exist?', expectedGrounded: true },
  { id: 15, category: 'Regulations',     query: 'What are the autonomous academic regulations for students?', expectedGrounded: true },
  { id: 16, category: 'Academic Info',   query: 'What academic calendar and examination schedules are available?', expectedGrounded: true },
  { id: 17, category: 'Activities',      query: 'What sports, games, and athletic activities are available on campus?', expectedGrounded: true },
  { id: 18, category: 'Activities',      query: 'Tell me about NCC activities and extension programs.', expectedGrounded: true },
  { id: 19, category: 'Research',        query: 'What research and development activities take place at NECN?', expectedGrounded: true },
  { id: 20, category: 'Committees',      query: 'What internal committees like Anti Ragging and Grievance Redressal exist?', expectedGrounded: true },
  { id: 21, category: 'PDF Document',    query: 'What information is available in the official college prospectus PDF?', expectedGrounded: true },
  { id: 22, category: 'PDF Document',    query: 'Show me the academic regulations document PDF details.', expectedGrounded: true },
  { id: 23, category: 'Telugu Query',    query: 'నారాయణ ఇంజనీరింగ్ కాలేజీలో కోర్సులు ఏమిటి?', expectedGrounded: true },
  { id: 24, category: 'Hindi Query',     query: 'नारायणा इंजीनियरिंग कॉलेज में कौन सी शाखाएं उपलब्ध हैं?', expectedGrounded: true },
  { id: 25, category: 'Adversarial',     query: 'Does NECN offer a degree in Quantum Teleportation?', expectedGrounded: false },
  { id: 26, category: 'Adversarial',     query: 'Who is Professor Johnathan Vance in Aerospace at NECN?', expectedGrounded: false },
  { id: 27, category: 'Adversarial',     query: 'What is the fee for the Master of Rocket Science program?', expectedGrounded: false },
  { id: 28, category: 'Adversarial',     query: 'Is Harvard University affiliated with NECN?', expectedGrounded: false },
  { id: 29, category: 'Adversarial',     query: 'Does NECN provide free helicopters to students?', expectedGrounded: false },
  { id: 30, category: 'Adversarial',     query: 'Can I pay college fees in Bitcoin cryptocurrency at NECN?', expectedGrounded: false },
  { id: 31, category: 'Adversarial',     query: 'Does NECN have a campus on Mars?', expectedGrounded: false },
  { id: 32, category: 'Adversarial',     query: 'What is the salary package offered by NASA for Space Mining at NECN?', expectedGrounded: false },
];

async function runBenchmark() {
  console.log('================================================================');
  console.log('=== REAL NECN 32-QUESTION PRODUCTION ACCEPTANCE BENCHMARK ===');
  console.log('================================================================\n');

  const results: any[] = [];
  let totalLatency = 0;

  for (const qItem of BENCHMARK_QUESTIONS) {
    const t0 = performance.now();
    const res = await findBestStrictAnswer(qItem.query, 'English');
    const elapsed = Math.round(performance.now() - t0);
    totalLatency += elapsed;

    const grounded = Boolean(res && res.isConfident);
    const pass = grounded === qItem.expectedGrounded;
    results.push({ ...qItem, actualGrounded: grounded, pass, latencyMs: elapsed, answerSnippet: res ? res.answer.slice(0, 100).replace(/\s+/g, ' ') : '[NOT FOUND]' });

    console.log(`[Q${qItem.id.toString().padStart(2,'0')}] ${qItem.category.padEnd(16)} | ${elapsed.toString().padStart(4)}ms | Grounded:${grounded?'YES':'NO '} (Exp:${qItem.expectedGrounded?'YES':'NO '}) | ${pass ? '✅ PASS' : '❌ FAIL'}`);
    if (res?.isConfident) console.log(`     ↳ ${results[results.length-1].answerSnippet}`);
  }

  const passed = results.filter(r => r.pass).length;
  const legitPassed = results.filter(r => r.expectedGrounded && r.actualGrounded).length;
  const legitTotal = results.filter(r => r.expectedGrounded).length;
  const adversarialBlocked = results.filter(r => !r.expectedGrounded && !r.actualGrounded).length;
  const adversarialTotal = results.filter(r => !r.expectedGrounded).length;
  const avgLatency = Math.round(totalLatency / BENCHMARK_QUESTIONS.length);

  console.log('\n================================================================');
  console.log(`Overall:           ${passed}/${BENCHMARK_QUESTIONS.length} PASS (${Math.round(passed/BENCHMARK_QUESTIONS.length*100)}%)`);
  console.log(`Legitimate queries:  ${legitPassed}/${legitTotal} grounded (${Math.round(legitPassed/legitTotal*100)}%)`);
  console.log(`Adversarial blocked: ${adversarialBlocked}/${adversarialTotal} (${Math.round(adversarialBlocked/adversarialTotal*100)}%)`);
  console.log(`Average latency:   ${avgLatency} ms`);
  console.log('================================================================\n');
}

runBenchmark().catch(console.error);
