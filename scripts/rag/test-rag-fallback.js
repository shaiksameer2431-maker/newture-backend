import { semanticSearchWebsite, semanticRagStatus } from './src/services/semanticRag.js';

console.log('Testing RAG retrieval & fallback safety...');

async function run() {
  console.log('RAG status:', semanticRagStatus());
  console.log('Executing semanticSearchWebsite("What courses are available at NECN?")...');
  const t0 = Date.now();
  const results = await semanticSearchWebsite('What courses are available at NECN?', 5);
  console.log(`Search completed in ${Date.now() - t0}ms! Hits found:`, results.length);
  if (results.length > 0) {
    console.log('Top hit:', results[0].title, 'url:', results[0].url, 'similarity:', results[0].similarity);
  }
}

run().catch(err => console.error('RAG test error:', err));
