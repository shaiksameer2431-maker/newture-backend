import { bm25Search, fts5Available } from './src/services/retrieval.js';
import { semanticSearchWebsite } from './src/services/semanticRag.js';

async function debugQ10Evidence() {
  console.log('=== DEBUG Q10 EVIDENCE ===\n');
  console.log('Query: What campus infrastructure, hostel, and canteen facilities exist?\n');
  
  const query = 'What campus infrastructure, hostel, and canteen facilities exist?';
  
  console.log('BM25 Results:');
  const bm25Results = bm25Search(query, 10);
  for (const result of bm25Results) {
    console.log(`  ${result.chunkId.slice(0, 8)} score=${result.score} ${result.url}`);
    console.log(`    Content preview: ${result.content.slice(0, 200)}...`);
  }
  
  console.log('\nSemantic Results:');
  const semanticResults = await semanticSearchWebsite(query, 10);
  for (const result of semanticResults) {
    console.log(`  ${result.chunkId.slice(0, 8)} sim=${result.similarity.toFixed(3)} ${result.url}`);
    console.log(`    Content preview: ${result.content.slice(0, 200)}...`);
  }
}

debugQ10Evidence().catch(console.error);
