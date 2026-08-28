import { semanticSearchWebsite } from './src/services/semanticRag.js';
import { bm25Search } from './src/services/retrieval.js';

async function debugQ10Full() {
  console.log('=== DEBUG Q10 FULL PIPELINE ===\n');
  console.log('Query: What campus infrastructure, hostel, and canteen facilities exist?\n');
  
  const query = 'What campus infrastructure, hostel, and canteen facilities exist?';
  
  // Get retrieval results
  const bm25Results = bm25Search(query, 5);
  const semanticResults = await semanticSearchWebsite(query, 5);
  
  console.log('BM25 Results (top 5):');
  for (const result of bm25Results) {
    console.log(`  ${result.chunkId.slice(0, 8)} score=${result.score} ${result.url}`);
  }
  
  console.log('\nSemantic Results (top 5):');
  for (const result of semanticResults) {
    console.log(`  ${result.chunkId.slice(0, 8)} sim=${result.similarity.toFixed(3)} ${result.url}`);
  }
  
  // Simulate the evidence selection
  const evidence = bm25Results.slice(0, 4).map(hit => ({
    chunkId: hit.chunkId,
    pageId: '',
    content: hit.content,
    title: hit.title,
    category: hit.section || 'General',
    url: hit.url,
    similarity: 0,
    lexicalScore: hit.score / 100,
    combinedScore: hit.score / 100,
    lastUpdated: new Date().toISOString()
  }));
  
  console.log('\nEvidence content (first 1000 chars each):');
  for (let i = 0; i < evidence.length; i++) {
    console.log(`\nEvidence ${i + 1}: ${evidence[i].title}`);
    console.log(evidence[i].content.slice(0, 1000));
  }
  
  // Check for key terms in evidence
  const fullEvidenceText = evidence.map(e => e.content.toLowerCase()).join(' ');
  console.log('\n\nTerm search in evidence:');
  console.log('  "infrastructure":', fullEvidenceText.includes('infrastructure') ? 'FOUND' : 'NOT FOUND');
  console.log('  "hostel":', fullEvidenceText.includes('hostel') ? 'FOUND' : 'NOT FOUND');
  console.log('  "canteen":', fullEvidenceText.includes('canteen') ? 'FOUND' : 'NOT FOUND');
  console.log('  "facility":', fullEvidenceText.includes('facility') ? 'FOUND' : 'NOT FOUND');
  console.log('  "facilities":', fullEvidenceText.includes('facilities') ? 'FOUND' : 'NOT FOUND');
}

debugQ10Full().catch(console.error);
