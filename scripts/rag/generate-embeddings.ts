import { generateEmbeddingsForMissingChunks } from './src/services/embedding.js';

console.log('============================================================');
console.log('GENERATE EMBEDDINGS FOR UPDATED CHUNKS');
console.log('============================================================\n');

try {
  const result = await generateEmbeddingsForMissingChunks();
  console.log('Embedding generation complete');
  console.log(`Processed: ${result.processed} chunks`);
  console.log(`Skipped: ${result.skipped} chunks`);
  console.log(`Failed: ${result.failed} chunks`);
} catch (error) {
  console.error('Error generating embeddings:', error);
  process.exit(1);
}
