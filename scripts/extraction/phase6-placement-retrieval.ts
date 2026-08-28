import { bm25Search } from './src/services/retrieval.js';
import { semanticSearchWebsite } from './src/services/semanticRag.js';

const query = "What are the placement statistics and top recruiting companies at NECN?";

console.log('============================================================');
console.log('PHASE 6: PLACEMENT RETRIEVAL INVESTIGATION');
console.log('============================================================\n');
console.log(`Query: ${query}\n`);

console.log('=== BM25 SEARCH (TOP 20) ===');
const bm25Results = bm25Search(query, 20);
for (let i = 0; i < bm25Results.length; i++) {
  const result = bm25Results[i];
  console.log(`${i + 1}. ${result.url}`);
  console.log(`   Score: ${result.score}`);
  console.log(`   Title: ${result.title}`);
  console.log(`   Content preview: ${result.content.slice(0, 100)}...`);
  console.log();
}

console.log('=== SEMANTIC SEARCH (TOP 20) ===');
const semanticResults = await semanticSearchWebsite(query, 20);
for (let i = 0; i < semanticResults.length; i++) {
  const result = semanticResults[i];
  console.log(`${i + 1}. ${result.url}`);
  console.log(`   Similarity: ${result.similarity.toFixed(4)}`);
  console.log(`   Title: ${result.title}`);
  console.log(`   Content preview: ${result.content.slice(0, 100)}...`);
  console.log();
}

// Check if placement page is in results
const placementUrl = 'https://necn.ac.in/2023-24-placements.php';
const bm25HasPlacement = bm25Results.some(r => r.url === placementUrl);
const semanticHasPlacement = semanticResults.some(r => r.url === placementUrl);

console.log('=== PLACEMENT PAGE DETECTION ===');
console.log(`Placement URL: ${placementUrl}`);
console.log(`Found in BM25 top 20: ${bm25HasPlacement ? 'YES' : 'NO'}`);
console.log(`Found in Semantic top 20: ${semanticHasPlacement ? 'YES' : 'NO'}`);

if (bm25HasPlacement) {
  const placementBm25 = bm25Results.find(r => r.url === placementUrl);
  console.log(`BM25 rank: ${bm25Results.indexOf(placementBm25) + 1}`);
  console.log(`BM25 score: ${placementBm25.score}`);
}

if (semanticHasPlacement) {
  const placementSemantic = semanticResults.find(r => r.url === placementUrl);
  console.log(`Semantic rank: ${semanticResults.indexOf(placementSemantic) + 1}`);
  console.log(`Semantic similarity: ${placementSemantic.similarity.toFixed(4)}`);
}
