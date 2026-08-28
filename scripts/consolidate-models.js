import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelRoot = path.resolve(__dirname, '..', '..', 'models');

function sha256(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

console.log('--- CONSOLIDATING MODEL DIRECTORIES ---');
console.log('Model Root:', modelRoot);

const dupEmb = path.join(modelRoot, 'embeddings', 'embeddings');
const dupLlm = path.join(modelRoot, 'local-llm', 'local-llm');

if (fs.existsSync(dupEmb)) {
  console.log('Removing duplicate directory:', dupEmb);
  fs.rmSync(dupEmb, { recursive: true, force: true });
} else {
  console.log('Duplicate embeddings folder already removed or not found.');
}

if (fs.existsSync(dupLlm)) {
  console.log('Removing duplicate directory:', dupLlm);
  fs.rmSync(dupLlm, { recursive: true, force: true });
} else {
  console.log('Duplicate local-llm folder already removed or not found.');
}

console.log('\n--- CANONICAL MODEL FILE VERIFICATION ---');

const canonicalFiles = [
  'local-llm/config.json',
  'local-llm/tokenizer.json',
  'local-llm/tokenizer_config.json',
  'local-llm/onnx/encoder_model_quantized.onnx',
  'local-llm/onnx/decoder_model_merged_quantized.onnx',
  'embeddings/config.json',
  'embeddings/special_tokens_map.json',
  'embeddings/tokenizer.json',
  'embeddings/tokenizer_config.json',
  'embeddings/onnx/model_quantized.onnx'
];

for (const rel of canonicalFiles) {
  const fullPath = path.join(modelRoot, rel);
  if (fs.existsSync(fullPath)) {
    const stat = fs.statSync(fullPath);
    const hash = sha256(fullPath);
    console.log(`✅ [CANONICAL] ${rel} | Size: ${stat.size} bytes | SHA256: ${hash}`);
  } else {
    console.error(`❌ [MISSING] ${rel}`);
  }
}
