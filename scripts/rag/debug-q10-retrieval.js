import { findBestStrictAnswer } from './src/services/knowledgeEngine.js';

async function debugQ10() {
  console.log('=== DEBUG Q10 RETRIEVAL ===\n');
  console.log('Query: What campus infrastructure, hostel, and canteen facilities exist?\n');
  
  const result = await findBestStrictAnswer('What campus infrastructure, hostel, and canteen facilities exist?', 'English');
  
  console.log('Result:', result);
  
  if (result && result.sources) {
    console.log('\nSources:');
    for (const source of result.sources) {
      console.log(`  - ${source.title}`);
      console.log(`    URL: ${source.url}`);
      console.log(`    Chunk ID: ${source.chunkId}`);
    }
  }
}

debugQ10().catch(console.error);
