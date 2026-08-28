import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const runtimeDirectory = typeof __dirname === 'string' ? __dirname : process.cwd();
const backendDirectory = path.basename(runtimeDirectory) === 'dist' ? path.resolve(runtimeDirectory, '..') : path.resolve(runtimeDirectory);
const modelRoot = path.join(backendDirectory, 'models');
const llmDir = path.join(modelRoot, 'Xenova', 'LaMini-Flan-T5-77M');

export class LocalLlm {
  private generator: any;
  private loading?: Promise<boolean>;

  async load(): Promise<boolean> {
    if (this.generator) return true;
    if (this.loading) return this.loading;
    this.loading = this.loadInternal();
    return this.loading;
  }

  private async loadInternal(): Promise<boolean> {
    const decoder = path.join(llmDir, 'onnx', 'decoder_model_merged_quantized.onnx');
    const encoder = path.join(llmDir, 'onnx', 'encoder_model_quantized.onnx');
    if (!fs.existsSync(decoder) || !fs.existsSync(encoder)) {
      console.warn('[LocalLLM] Bundled ONNX files are missing; remote download is disabled.');
      return false;
    }
    const transformers = await import('@xenova/transformers');
    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = false;
    transformers.env.localModelPath = modelRoot;
    this.generator = await transformers.pipeline('text2text-generation', 'Xenova/LaMini-Flan-T5-77M');
    console.log('MODEL_SOURCE=LOCAL_PROJECT');
    console.log('LOCAL_LLM_LOADED=true');
    console.log('GENERATION_MODE=LOCAL_LLM');
    console.log('REMOTE_MODEL_DOWNLOAD=false');
    console.log('NETWORK_REQUIRED=false');
    return true;
  }

  async generate(prompt: string): Promise<string> {
    if (!await this.load()) throw new Error('Local LLM unavailable');
    const output = await this.generator(prompt, { max_new_tokens: 256, temperature: 0.2, do_sample: false });
    return Array.isArray(output) ? String(output[0]?.generated_text || '').trim() : String(output || '').trim();
  }

  status() {
    const decoder = path.join(llmDir, 'onnx', 'decoder_model_merged_quantized.onnx');
    return {
      available: fs.existsSync(decoder), loaded: Boolean(this.generator), model: 'LaMini-Flan-T5-77M (Local ONNX)',
      modelPath: llmDir,
      sha256: fs.existsSync(decoder) ? crypto.createHash('sha256').update(fs.readFileSync(decoder)).digest('hex') : null,
      allowLocalModels: true, allowRemoteModels: false,
    };
  }
}

export const localLlm = new LocalLlm();
