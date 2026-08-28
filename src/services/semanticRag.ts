import { getDb } from '../database/db.js';
import { localLlm } from './localLlm.js';
import path from 'node:path';

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
const LLM_MODEL = 'LaMini-Flan-T5-77M (Local ONNX)';
const runtimeDirectory = typeof __dirname === 'string' ? __dirname : process.cwd();
const backendDirectory = path.basename(runtimeDirectory) === 'dist' ? path.resolve(runtimeDirectory, '..') : path.resolve(runtimeDirectory);
const modelRoot = path.join(backendDirectory, 'models');

export interface SemanticChunk {
  chunkId: string; pageId: string; content: string; title: string; category: string;
  url: string; similarity: number; lexicalScore: number; combinedScore: number; lastUpdated: string;
}

let extractor: any | undefined;
async function loadExtractor(): Promise<any> {
  if (extractor) return extractor;
  try {
    const transformers = await import('@xenova/transformers');
    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = false;
    transformers.env.localModelPath = modelRoot.replace(/\\/g, '/') + '/';
    extractor = await transformers.pipeline('feature-extraction', EMBEDDING_MODEL, { quantized: true });
    return extractor;
  } catch (error) {
    throw new Error(`[RAG] Local MiniLM model is unavailable; remote downloads are disabled: ${error instanceof Error ? error.message : error}`);
  }
}

async function embed(text: string): Promise<{ vector: number[]; model: string }> {
  const pipeline = await loadExtractor();
  const output = await pipeline(text.slice(0, 7000), { pooling: 'mean', normalize: true });
  return { vector: Array.from(output.data), model: EMBEDDING_MODEL };
}

function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export async function embedPendingWebsiteChunks(limit = 40): Promise<{ processed: number; failed: number }> {
  const db = getDb();
  const batchSize = Math.max(1, Math.min(limit, 200));
  const rows = db.prepare(`SELECT c.id, c.content FROM website_chunks c JOIN website_pages p ON p.id=c.page_id
    WHERE p.is_active=1 AND trim(c.content)<>'' AND (c.embedding_json IS NULL OR c.embedding_model <> ?) AND c.embedded_at IS NULL
    ORDER BY c.created_at LIMIT ?`).all(EMBEDDING_MODEL, batchSize) as any[];
  const updateSuccess = db.prepare('UPDATE website_chunks SET embedding_json=?, embedding_model=?, embedding_dim=?, embedded_at=? WHERE id=?');
  const updateFailed = db.prepare('UPDATE website_chunks SET embedded_at=? WHERE id=?');
  let processed = 0, failed = 0;
  for (const row of rows) {
    try {
      const result = await embed(row.content);
      updateSuccess.run(JSON.stringify(result.vector), result.model, result.vector.length, new Date().toISOString(), row.id);
      processed++;
    } catch (error) {
      failed++;
      updateFailed.run(new Date().toISOString(), row.id);
      console.warn('[RAG] embedding failed', row.id, error instanceof Error ? error.message : error);
    }
  }
  return { processed, failed };
}

export async function drainAllPendingWebsiteChunks(): Promise<{ totalProcessed: number; totalFailed: number }> {
  let totalProcessed = 0;
  let totalFailed = 0;
  let iterations = 0;
  while (iterations < 100) {
    iterations++;
    const res = await embedPendingWebsiteChunks(100);
    totalProcessed += res.processed;
    totalFailed += res.failed;
    if (res.processed === 0 && res.failed === 0) break;
  }
  console.log(`[RAG EMBEDDINGS] Backlog drain completed: Processed=${totalProcessed}, Failed=${totalFailed}`);
  return { totalProcessed, totalFailed };
}

export async function semanticSearchWebsite(query: string, limit = 12): Promise<SemanticChunk[]> {
  const queryEmbedding = await embed(query);
  const db = getDb();
  const rows = db.prepare(`SELECT c.id chunk_id,c.page_id,c.content,c.embedding_json,c.embedding_model,c.created_at,p.title,p.category,p.url,p.last_changed
    FROM website_chunks c JOIN website_pages p ON p.id=c.page_id
    WHERE p.is_active=1 AND c.embedding_json IS NOT NULL AND c.embedding_model=?`).all(queryEmbedding.model) as any[];
  return rows.map(row => {
    let vector: number[] = []; try { vector = JSON.parse(row.embedding_json); } catch { /* ignore corrupt stored vector */ }
    const similarity = cosine(queryEmbedding.vector, vector);
    return { chunkId: row.chunk_id, pageId: row.page_id, content: row.content, title: row.title || 'NECN Official Website', category: row.category || 'General', url: row.url, similarity, lexicalScore: 0, combinedScore: similarity, lastUpdated: row.last_changed || row.created_at };
  }).filter(hit => hit.similarity >= 0.32).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

function extractiveAnswer(evidence: SemanticChunk[], _query = ''): string | null {
  if (!evidence || !evidence.length) return null;
  for (const item of evidence.slice(0, 3)) {
    const text = item.content.replace(/##H\d##|##TR##|##TABLE##/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length >= 30) {
      return text.slice(0, 450).trim();
    }
  }
  return null;
}

export function sanitizeUserFacingAnswer(rawAnswer: string): string {
  if (!rawAnswer) return '';
  let clean = rawAnswer;

  // 1. Remove internal evidence markers, prompts, and header garbage
  clean = clean.replace(/---+\s*OFFICIAL NECN EVIDENCE\s*---+[\s\S]*/gi, '');
  clean = clean.replace(/^According to (?:the )?official NECN (?:records|sources?)[,:]?\s*/gi, '');
  clean = clean.replace(/^Based on official NECN records:?\s*/gi, '');
  clean = clean.replace(/\[Source\s*\d+:?[^\]]*\]/gi, '');
  clean = clean.replace(/##H\d##/g, '');
  clean = clean.replace(/##TR##/g, '');
  clean = clean.replace(/##TABLE##/g, '');
  clean = clean.replace(/chunkId:\s*[a-f0-9-]+/gi, '');
  clean = clean.replace(/databaseID:\s*[a-f0-9-]+/gi, '');

  // 2. Remove duplicated lines
  const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const uniqueLines: string[] = [];
  for (const line of lines) {
    if (!uniqueLines.includes(line)) {
      uniqueLines.push(line);
    }
  }
  clean = uniqueLines.join('\n');

  // 3. Prevent whole-response bolding
  if (/^\*\*[^*]+\*\*$/.test(clean.trim())) {
    clean = clean.trim().slice(2, -2).trim();
  }

  return clean.trim();
}

function cleanChunkContent(raw: string): string {
  let cleaned = raw.replace(/^(?:•\s*)*(?:About Us|Vision and Mission|Founder's Desk|Affliated university|Accreditation|Recognition|Annual Reports|Organisation Chart|NEC Nellore \| Narayana Engineering College|HOME|\s+)+/gi, '').trim();
  cleaned = cleaned.replace(/(?:•\s*){3,}/g, ' ');
  return cleaned || raw;
}

export async function generateGroundedAnswer(query: string, evidence: SemanticChunk[], language = 'English'): Promise<string | null> {
  if (!evidence.length) return null;

  function extractBodyContent(raw: string): string {
    const cleaned = cleanChunkContent(raw);
    if (cleaned.length <= 800) return cleaned.slice(0, 500).trim();
    return cleaned.slice(0, 800).trim();
  }

  // Bound evidence to prevent LLM context overflow while extracting body past nav chrome
  const boundedEvidence = evidence.slice(0, 4).map(item => ({
    ...item,
    content: extractBodyContent(item.content)
  }));
  const context = boundedEvidence.map((item, index) => `[Source ${index + 1}: ${item.title}]\n${item.content}`).join('\n\n');
  const contextChars = context.length;
  const queryTokens = (query.match(/\s+/g) || []).length + 1;
  const estimatedInputTokens = Math.ceil((contextChars + query.length + 120) / 4);

  // Anti-hallucination check: ensure core query topic nouns appear in the FULL retrieved evidence.
  const isEnglish = /^[\x00-\x7F\s\.,\?!'\-":\;\(\)&]+$/.test(query);
  if (isEnglish) {
    const IGNORED_VERIFY = new Set([
      'what','where','which','when','with','from','have','about','please','tell','need','want','can',
      'could','should','would','whom','who','how','is','are','the','a','an','for','does','do','did',
      'was','were','be','get','give','find','know','show','look','also','their','this','that',
      'these','those','some','any','much','many','more','most','only','just','then','than',
      'into','over','after','each','your','will','here','there','has','had','been','very',
      'and','or','but','not','no','yes','all','any','both','either','neither','so','such','necn','college'
    ]);

    const queryNouns = (query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(t => !IGNORED_VERIFY.has(t));
    const fullEvidenceText = evidence.slice(0, 4).map(e => e.content.toLowerCase()).join(' ');

    // Check for specific non-generic nouns that have 0 matches in evidence (with stem prefix matching)
    const isMatched = (noun: string) => {
      if (fullEvidenceText.includes(noun)) return true;
      const stem = noun.length > 4 ? noun.slice(0, noun.length - 2) : noun.slice(0, 3);
      return fullEvidenceText.includes(stem);
    };
    const ungroundedSpecificNouns = queryNouns.filter(noun => !isMatched(noun));
    if (ungroundedSpecificNouns.length > 0 && ungroundedSpecificNouns.length >= Math.ceil(queryNouns.length * 0.7)) {
      console.log(`[CHAT PIPELINE] GROUNDING_REJECTED: Specific query terms [${ungroundedSpecificNouns.join(', ')}] ungrounded in evidence; trying extractive fallback`);
      const fallback = extractiveAnswer(evidence, query);
      if (fallback) return sanitizeUserFacingAnswer(fallback);
      return null;
    }

    if (queryNouns.length >= 2) {
      const matchedCount = queryNouns.filter(t => isMatched(t)).length;
      if (matchedCount < Math.ceil(queryNouns.length * 0.20)) {
        console.log(`[CHAT PIPELINE] GROUNDING_REJECTED: Query terms overall coverage insufficient; trying extractive fallback`);
        const fallback = extractiveAnswer(evidence, query);
        if (fallback) return sanitizeUserFacingAnswer(fallback);
        return null;
      }
    }
  }

  console.log(`[RAG METRICS] QUERY_TOKENS=${queryTokens} CONTEXT_CHARS=${contextChars} ESTIMATED_INPUT_TOKENS=${estimatedInputTokens} EVIDENCE_COUNT=${boundedEvidence.length}`);
  console.log('[CHAT PIPELINE] LLM_GENERATION_START');

  try {
    const answer = await localLlm.generate(`Answer only from the official NECN evidence below. Do not use outside knowledge, guess, or invent facts. If the evidence is insufficient, return exactly NOT_FOUND. Respond in ${language}.\n\nUSER QUESTION:\n${query}\n\n--- OFFICIAL NECN EVIDENCE ---\n${context}\n-----------------------------`);
    console.log('[CHAT PIPELINE] LLM_GENERATION_COMPLETE');
    if (!answer || answer.trim() === 'NOT_FOUND' || answer.includes('NOT_FOUND')) {
      console.log('[CHAT PIPELINE] LLM output insufficient, trying extractive fallback from evidence');
      const fallback = extractiveAnswer(evidence, query);
      return fallback ? sanitizeUserFacingAnswer(fallback) : null;
    }
    const sanitized = sanitizeUserFacingAnswer(answer);
    if (!sanitized || sanitized.trim().length < 10) {
      console.log('[CHAT PIPELINE] Sanitized LLM answer empty or too short, using extractive fallback');
      const fallback = extractiveAnswer(evidence, query);
      return fallback ? sanitizeUserFacingAnswer(fallback) : null;
    }
    console.log('[CHAT PIPELINE] GROUNDING_COMPLETE (Answer generated)');
    return sanitized;
  } catch (err) {
    console.warn('[RAG] Local LLM generation failed, falling back to extractive answer:', err);
    const fallback = extractiveAnswer(evidence, query);
    return fallback ? sanitizeUserFacingAnswer(fallback) : null;
  }
}

export function localLlmStatus() {
  return localLlm.status();
}

export function semanticRagStatus() {
  const db = getDb();
  const totalChunks = (db.prepare('SELECT count(*) n FROM website_chunks').get() as any).n;
  const embeddedChunks = (db.prepare('SELECT count(*) n FROM website_chunks WHERE embedding_json IS NOT NULL').get() as any).n;
  return { enabled: true, provider: 'local', embeddingModel: EMBEDDING_MODEL, fallbackEmbeddingModel: null, answerModel: LLM_MODEL, localLlm: localLlm.status(), totalChunks, embeddedChunks, pendingChunks: totalChunks - embeddedChunks };
}
