import { findBestStrictAnswer } from './src/services/knowledgeEngine.js';

async function main() {
  const questions = [
    "Who is the Principal?",
    "Who is the CSE HOD?",
    "What is the admission procedure?",
    "What is the CSE department email?",
    "What is the official NECN address?",
    "What facilities does NECN provide?"
  ];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    console.log(`\n==================================================`);
    console.log(`QUESTION ${i + 1}: ${q}`);
    console.log(`==================================================`);
    const result = await findBestStrictAnswer(q, 'English');
    console.log("RESULT:", JSON.stringify(result, null, 2));
  }
}

main().catch(err => console.error(err));
