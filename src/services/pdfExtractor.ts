/**
 * pdfExtractor.ts — Production-Grade Universal Multi-Layer PDF Extraction Engine
 *
 * Designed to process any NECN PDF document automatically (catalogs, regulations,
 * faculty tables, placement charts, notices, research reports) without hardcoded
 * filenames or URL rules.
 */

import { Worker } from 'node:worker_threads';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ============================================================================
// Interfaces
// ============================================================================

export interface PdfPageDetail {
  pageNumber: number;
  text: string;
  extractionMethod: 'primary_parser' | 'flate_stream' | 'system_cli' | 'tesseract_ocr' | 'fallback_partial';
  ocrUsed: boolean;
  qualityScore: number;
  textLength: number;
  wordCount: number;
  extractionStatus: 'SUCCESS' | 'PARTIAL' | 'SCANNED' | 'FAILED' | 'OCR_UNAVAILABLE';
}

export interface UniversalPdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
  modDate?: string;
  pageCount: number;
  isEncrypted: boolean;
  isPasswordProtected: boolean;
}

export interface UniversalPdfExtractResult {
  ok: boolean;
  title: string;
  pageCount: number;
  pages: PdfPageDetail[];
  fullText: string;
  extractionMethod: string;
  extractionStatus: 'SUCCESS' | 'PARTIAL' | 'SCANNED' | 'PDF_PASSWORD_PROTECTED' | 'PDF_CORRUPTED' | 'OCR_UNAVAILABLE' | 'FAILED';
  textLength: number;
  wordCount: number;
  pagesWithText: number;
  pagesWithOCR: number;
  failedPages: number;
  qualityScore: number;
  reason?: string;
  metadata: UniversalPdfMetadata;
  durationMs: number;
}

export interface PdfExtractOptions {
  maxMs?: number;
  enableOcr?: boolean;
}

// ============================================================================
// 1. PDF Validation & Signature Checks
// ============================================================================

export function hasPdfSignature(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 5) return false;
  const head = buffer.slice(0, 1024).toString('latin1').trimStart();
  return /^\s*%PDF-\d\.\d/.test(head);
}

export function isEncryptedOrProtected(buffer: Buffer): { isEncrypted: boolean; isPasswordProtected: boolean } {
  const binary = buffer.toString('latin1');
  const hasEncrypt = /\/Encrypt\s+\d+\s+\d+\s+R/.test(binary) || /\/Encrypt\s*<</.test(binary);
  if (!hasEncrypt) return { isEncrypted: false, isPasswordProtected: false };
  // Check if standard password dictionary prohibits reading without password
  const hasOwnerKey = /\/O\s*\(/i.test(binary) || /\/U\s*\(/i.test(binary);
  return { isEncrypted: true, isPasswordProtected: hasOwnerKey };
}

// ============================================================================
// 2. PDF Metadata Extractor
// ============================================================================

function extractPdfMetadata(buffer: Buffer): UniversalPdfMetadata {
  const binary = buffer.toString('latin1');
  
  // Page count estimation
  let pageCount = 0;
  const countMatches = [...binary.matchAll(/\/Count\s+(\d+)/g)];
  for (const m of countMatches) {
    const val = parseInt(m[1], 10);
    if (val > pageCount) pageCount = val;
  }
  if (pageCount === 0) {
    const pageObjCount = (binary.match(/\/Type\s*\/Page\b/g) || []).length;
    pageCount = Math.max(1, pageObjCount);
  }

  const getMetaField = (key: string): string | undefined => {
    const re = new RegExp(`\\/${key}\\s*\\(([^)]+)\\)`, 'i');
    const match = binary.match(re);
    return match ? decodePdfLiteral(match[1]) : undefined;
  };

  const encInfo = isEncryptedOrProtected(buffer);

  return {
    title: getMetaField('Title'),
    author: getMetaField('Author'),
    subject: getMetaField('Subject'),
    creator: getMetaField('Creator'),
    producer: getMetaField('Producer'),
    creationDate: getMetaField('CreationDate'),
    modDate: getMetaField('ModDate'),
    pageCount,
    isEncrypted: encInfo.isEncrypted,
    isPasswordProtected: encInfo.isPasswordProtected
  };
}

// ============================================================================
// 3. Low-level Stream & String Decoders
// ============================================================================

function decodePdfLiteral(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') { out += ch; continue; }
    const next = raw[++i];
    if (next === undefined) break;
    const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\\': '\\', '(': '(', ')': ')' };
    if (map[next]) { out += map[next]; continue; }
    if (/^[0-7]$/.test(next)) {
      let oct = next;
      for (let j = 0; j < 2 && i + 1 < raw.length && /^[0-7]$/.test(raw[i + 1]); j++) oct += raw[++i];
      out += String.fromCharCode(parseInt(oct, 8));
      continue;
    }
    out += next;
  }
  return out;
}

function decodePdfString(token: string): string {
  const trimmed = token.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>') && !trimmed.startsWith('<<')) {
    const hex = trimmed.slice(1, -1).replace(/\s+/g, '');
    const even = hex.length % 2 ? `${hex}0` : hex;
    try { return Buffer.from(even, 'hex').toString('utf8'); } catch {
      try { return Buffer.from(even, 'hex').toString('latin1'); } catch { return ''; }
    }
  }
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) return decodePdfLiteral(trimmed.slice(1, -1));
  return '';
}

// ============================================================================
// 4. Quality Scoring Engine
// ============================================================================

export function calculatePageQuality(text: string): number {
  if (!text || text.trim().length === 0) return 0.0;
  const trimmed = text.trim();
  const len = trimmed.length;
  if (len < 10) return 0.1;

  // Printable Unicode & ASCII characters
  let printable = 0;
  let words = 0;
  for (let i = 0; i < len; i++) {
    const code = trimmed.charCodeAt(i);
    // Allow printable ASCII + tabs/newlines + Latin/Unicode range
    if ((code >= 0x20 && code <= 0x7E) || code === 0x0A || code === 0x0D || code === 0x09 || code >= 0x00C0) {
      printable++;
    }
  }

  const wordMatches = trimmed.match(/[\p{L}\p{N}]{2,}/gu) || [];
  words = wordMatches.length;

  const printableRatio = printable / len;
  const whitespaceRatio = (trimmed.match(/\s/g) || []).length / len;

  // Garbage penalties
  const hasGarbageChars = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(trimmed);
  const repeatedGarbage = /(.)\1{12,}/.test(trimmed.replace(/\s+/g, ''));

  let score = printableRatio * 0.6 + Math.min(1, words / 30) * 0.4;
  if (whitespaceRatio > 0.65) score *= 0.7;
  if (hasGarbageChars) score *= 0.5;
  if (repeatedGarbage) score *= 0.3;

  return Math.min(1.0, Math.max(0.0, score));
}

// ============================================================================
// 5. Table & Structure Preservation
// ============================================================================

function formatTableLines(rawText: string): string {
  const lines = rawText.split(/\r?\n/);
  const formatted: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { formatted.push(''); continue; }

    // Detect tabbed or multi-spaced tabular rows (3+ columns separated by 2+ spaces or tabs)
    const columns = line.split(/\t+|\s{3,}/).map(c => c.trim()).filter(Boolean);
    if (columns.length >= 3) {
      formatted.push(`| ${columns.join(' | ')} |`);
    } else {
      formatted.push(trimmed);
    }
  }

  return formatted.join('\n');
}

// ============================================================================
// 6. Header/Footer Boilerplate Cleaner
// ============================================================================

function cleanHeaderFooterBoilerplate(pages: Array<{ pageNumber: number; text: string }>): Array<{ pageNumber: number; text: string }> {
  if (pages.length <= 2) return pages;

  const lineCounts = new Map<string, number>();
  const totalPages = pages.length;

  for (const page of pages) {
    const lines = page.text.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    
    // Check first 2 and last 2 lines per page
    const topLines = lines.slice(0, 2);
    const bottomLines = lines.slice(-2);
    const candidateLines = new Set([...topLines, ...bottomLines]);

    for (const cand of candidateLines) {
      // Ignore page number lines or very short numbers
      if (/^page\s*\d+(\s*of\s*\d+)?$/i.test(cand) || /^\d+$/.test(cand)) continue;
      lineCounts.set(cand, (lineCounts.get(cand) || 0) + 1);
    }
  }

  // Identify boilerplate lines appearing on > 60% of pages
  const boilerplate = new Set<string>();
  for (const [lineText, count] of lineCounts.entries()) {
    if (count / totalPages >= 0.60 && lineText.length >= 8) {
      boilerplate.add(lineText);
    }
  }

  if (boilerplate.size === 0) return pages;

  return pages.map(page => {
    const lines = page.text.split('\n');
    const cleaned = lines.filter(line => !boilerplate.has(line.trim()));
    return { pageNumber: page.pageNumber, text: cleaned.join('\n') };
  });
}

// ============================================================================
// 7. Layer 1 & 2 Stream Text Extractors (Decompressed Flate & Object Streams)
// ============================================================================

function extractRawTextFromStreams(buffer: Buffer): Map<number, string> {
  const binary = buffer.toString('latin1');
  const pageMap = new Map<number, string[]>();

  // Decompress all stream blocks
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch: RegExpExecArray | null;
  let currentPageNum = 1;

  while ((streamMatch = streamRegex.exec(binary))) {
    let streamBuf = Buffer.from(streamMatch[1], 'latin1');
    try { streamBuf = zlib.inflateSync(streamBuf); } catch { /* raw/uncompressed */ }
    const streamText = streamBuf.toString('latin1');

    // Detect explicit page marker / Page Object boundary
    if (streamText.includes('/Type /Page') || streamText.includes('/Type/Page')) {
      currentPageNum++;
    }

    if (!/(?:BT|Tj|TJ|Tf|Td|Tm)/.test(streamText)) continue;

    const pageLines: string[] = pageMap.get(currentPageNum) || [];
    const btBlocks = streamText.match(/BT([\s\S]*?)ET/g) || [streamText];

    for (const block of btBlocks) {
      const blockLines: string[] = [];
      
      // TJ array operators: [(text1) 12 (text2)] TJ
      const tjArrayRegex = /\[((?:\\.|\([^)]*\)|<[^>]*>|[^\]])*)\]\s*TJ/g;
      let m: RegExpExecArray | null;
      while ((m = tjArrayRegex.exec(block))) {
        const parts = m[1].match(/\([^)]*(?:\\.[^)]*)*\)|<[^>]*>/g) || [];
        const reconstructed: string[] = [];
        for (const part of parts) {
          const decoded = decodePdfString(part);
          if (decoded) reconstructed.push(decoded);
        }
        if (reconstructed.length) blockLines.push(reconstructed.join(''));
      }

      // Tj literal operators: (text) Tj
      const tjRegex = /(\([^)]*(?:\\.[^)]*)*\)|<[^>]*>)\s*Tj/g;
      while ((m = tjRegex.exec(block))) {
        const decoded = decodePdfString(m[1]);
        if (decoded) blockLines.push(decoded);
      }

      if (blockLines.length) pageLines.push(blockLines.join(' '));
    }

    if (pageLines.length) {
      pageMap.set(currentPageNum, pageLines);
      currentPageNum++;
    }
  }

  // Fallback if no streams matched
  if (pageMap.size === 0) {
    const rawMatches = binary.match(/\((?:\\.|[^)])*\)\s*Tj/g) || [];
    const fallbackLines: string[] = [];
    for (const item of rawMatches) {
      const decoded = decodePdfString(item.replace(/\s*Tj$/, ''));
      if (decoded) fallbackLines.push(decoded);
    }
    if (fallbackLines.length) pageMap.set(1, fallbackLines);
  }

  const result = new Map<number, string>();
  for (const [pageNum, lines] of pageMap.entries()) {
    const formatted = formatTableLines(lines.join('\n'));
    result.set(pageNum, formatted);
  }
  return result;
}

// ============================================================================
// 8. Layer 3 System CLI Extractor Fallback (pdftotext)
// ============================================================================

async function extractWithPdftotext(buffer: Buffer): Promise<Map<number, string> | null> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf-cli-'));
  const inputPdf = path.join(tempDir, 'input.pdf');
  const outputTxt = path.join(tempDir, 'output.txt');

  try {
    await fs.promises.writeFile(inputPdf, buffer);
    await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', inputPdf, outputTxt], { timeout: 30000 });
    const content = await fs.promises.readFile(outputTxt, 'utf8');

    // Formfeed character (\f) separates pages in pdftotext output
    const pageTexts = content.split('\f');
    const result = new Map<number, string>();
    pageTexts.forEach((pText, idx) => {
      const trimmed = pText.trim();
      if (trimmed) result.set(idx + 1, formatTableLines(trimmed));
    });
    return result.size ? result : null;
  } catch {
    return null;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ============================================================================
// 9. Layer 4 Tesseract OCR Fallback Engine (Page-level targeted OCR)
// ============================================================================

async function performPageOcr(buffer: Buffer, pageNum: number): Promise<string | null> {
  try {
    const tesseract = await import('tesseract.js');
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf-ocr-'));
    const inputPdf = path.join(tempDir, 'input.pdf');
    await fs.promises.writeFile(inputPdf, buffer);

    // If pdftoppm is available, render page to PNG first
    const pageImg = path.join(tempDir, `page-${pageNum}.png`);
    let imagePath = inputPdf;
    try {
      await execFileAsync('pdftoppm', ['-png', '-f', String(pageNum), '-l', String(pageNum), inputPdf, path.join(tempDir, `page-${pageNum}`)], { timeout: 30000 });
      if (fs.existsSync(pageImg)) imagePath = pageImg;
    } catch { /* pdftoppm unavailable; fallback to direct tesseract */ }

    const worker = await tesseract.createWorker('eng');
    const ret = await worker.recognize(imagePath);
    await worker.terminate();
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});

    return ret.data.text.trim() || null;
  } catch {
    return null;
  }
}

// ============================================================================
// 10. Master Universal PDF Extraction Entrypoint
// ============================================================================

export async function extractPdfDocument(
  buffer: Buffer,
  opts: PdfExtractOptions = {}
): Promise<UniversalPdfExtractResult> {
  const started = Date.now();
  const maxMs = opts.maxMs ?? 60_000;

  // 1. Signature Check
  if (!hasPdfSignature(buffer)) {
    const meta = extractPdfMetadata(buffer);
    return {
      ok: false,
      title: 'Corrupted PDF',
      pageCount: 0,
      pages: [],
      fullText: '',
      extractionMethod: 'none',
      extractionStatus: 'PDF_CORRUPTED',
      textLength: 0,
      wordCount: 0,
      pagesWithText: 0,
      pagesWithOCR: 0,
      failedPages: 0,
      qualityScore: 0,
      reason: 'PDF_CORRUPTED',
      metadata: meta,
      durationMs: Date.now() - started
    };
  }

  // 2. Encryption / Password Check
  const meta = extractPdfMetadata(buffer);
  if (meta.isPasswordProtected) {
    return {
      ok: false,
      title: meta.title || 'Password Protected PDF',
      pageCount: meta.pageCount,
      pages: [],
      fullText: '',
      extractionMethod: 'none',
      extractionStatus: 'PDF_PASSWORD_PROTECTED',
      textLength: 0,
      wordCount: 0,
      pagesWithText: 0,
      pagesWithOCR: 0,
      failedPages: meta.pageCount,
      qualityScore: 0,
      reason: 'PDF_PASSWORD_PROTECTED',
      metadata: meta,
      durationMs: Date.now() - started
    };
  }

  // 3. Multi-Layer Extraction Chain
  let rawPageMap = extractRawTextFromStreams(buffer);
  let primaryMethod = 'flate_stream';

  // Try System pdftotext CLI if stream extraction returned little text
  let streamTotalChars = 0;
  for (const text of rawPageMap.values()) streamTotalChars += text.length;

  if (streamTotalChars < 100) {
    const cliMap = await extractWithPdftotext(buffer);
    if (cliMap && cliMap.size) {
      rawPageMap = cliMap;
      primaryMethod = 'system_cli';
    }
  }

  // Determine total page count
  const totalPages = Math.max(meta.pageCount, rawPageMap.size, 1);
  const initialPages: Array<{ pageNumber: number; text: string }> = [];

  for (let p = 1; p <= totalPages; p++) {
    initialPages.push({
      pageNumber: p,
      text: rawPageMap.get(p) || ''
    });
  }

  // 4. Header & Footer Boilerplate Cleaning
  const cleanedPages = cleanHeaderFooterBoilerplate(initialPages);

  // 5. Per-Page Quality Evaluation & Targeted Partial OCR Fallback
  const pageDetails: PdfPageDetail[] = [];
  let pagesWithText = 0;
  let pagesWithOCR = 0;
  let failedPages = 0;
  let totalQualityScore = 0;

  for (const item of cleanedPages) {
    let pText = item.text.trim();
    let qScore = calculatePageQuality(pText);
    let method: PdfPageDetail['extractionMethod'] = primaryMethod as any;
    let ocrUsed = false;
    let pStatus: PdfPageDetail['extractionStatus'] = qScore >= 0.40 ? 'SUCCESS' : 'FAILED';

    // If page quality is low or empty, attempt targeted OCR on this page
    if (qScore < 0.40 && opts.enableOcr !== false) {
      const ocrText = await performPageOcr(buffer, item.pageNumber);
      if (ocrText && ocrText.length > 20) {
        const ocrScore = calculatePageQuality(ocrText);
        if (ocrScore > qScore) {
          pText = formatTableLines(ocrText);
          qScore = ocrScore;
          method = 'tesseract_ocr';
          ocrUsed = true;
          pStatus = 'SUCCESS';
          pagesWithOCR++;
        }
      } else if (pText.length === 0) {
        pStatus = 'SCANNED';
      }
    }

    const wordCount = (pText.match(/[\p{L}\p{N}]{2,}/gu) || []).length;
    if (pText.length > 0 && qScore >= 0.30) {
      pagesWithText++;
    } else {
      failedPages++;
    }

    totalQualityScore += qScore;

    pageDetails.push({
      pageNumber: item.pageNumber,
      text: pText,
      extractionMethod: method,
      ocrUsed,
      qualityScore: Number(qScore.toFixed(3)),
      textLength: pText.length,
      wordCount,
      extractionStatus: pStatus
    });
  }

  const overallQualityScore = Number((totalQualityScore / totalPages).toFixed(3));

  // 6. Build Final Formatted Document Text
  const fullTextParts: string[] = [];
  const docTitle = meta.title || 'NECN Official Document';
  fullTextParts.push(`DOCUMENT TITLE: ${docTitle}\n`);

  for (const page of pageDetails) {
    fullTextParts.push(`[PAGE ${page.pageNumber}]`);
    if (page.text) {
      fullTextParts.push(page.text);
    } else {
      fullTextParts.push(`[PAGE ${page.pageNumber} CONTENT UNREADABLE / SCANNED]`);
    }
    fullTextParts.push('');
  }

  const fullText = fullTextParts.join('\n').trim();
  const overallWordCount = (fullText.match(/[\p{L}\p{N}]{2,}/gu) || []).length;

  // Final Status Determination
  let overallStatus: UniversalPdfExtractResult['extractionStatus'] = 'SUCCESS';
  if (pagesWithText === 0) {
    overallStatus = 'SCANNED';
  } else if (failedPages > 0) {
    overallStatus = 'PARTIAL';
  }

  const isOk = pagesWithText > 0;

  return {
    ok: isOk,
    title: docTitle,
    pageCount: totalPages,
    pages: pageDetails,
    fullText,
    extractionMethod: primaryMethod,
    extractionStatus: overallStatus,
    textLength: fullText.length,
    wordCount: overallWordCount,
    pagesWithText,
    pagesWithOCR,
    failedPages,
    qualityScore: overallQualityScore,
    reason: isOk ? undefined : (pagesWithText === 0 ? 'PDF_EMPTY_TEXT' : 'LOW_EXTRACTION_QUALITY'),
    metadata: meta,
    durationMs: Date.now() - started
  };
}

// Backward compatibility wrappers for existing callers
export function extractPdfText(buffer: Buffer): string {
  const meta = extractPdfMetadata(buffer);
  const rawMap = extractRawTextFromStreams(buffer);
  const parts: string[] = [];
  for (let p = 1; p <= Math.max(1, rawMap.size); p++) {
    const text = rawMap.get(p);
    if (text) parts.push(`[PAGE ${p}]\n${text}`);
  }
  return parts.join('\n\n');
}

export async function safeExtractPdfText(buffer: Buffer, opts: PdfExtractOptions = {}): Promise<{ ok: boolean; text: string; reason?: string; method?: string; durationMs?: number }> {
  const result = await extractPdfDocument(buffer, opts);
  return {
    ok: result.ok,
    text: result.fullText,
    reason: result.reason,
    method: result.extractionMethod,
    durationMs: result.durationMs
  };
}

// Database helper to save page-level extractions into website_pdf_pages table
export function savePdfPageExtractions(db: any, pageId: string, pdfResult: UniversalPdfExtractResult): void {
  if (!db || !pageId || !pdfResult || !pdfResult.pages) return;

  const crypto = require('crypto');
  const deleteExisting = db.prepare('DELETE FROM website_pdf_pages WHERE page_id = ?');
  const insertPage = db.prepare(`
    INSERT INTO website_pdf_pages (
      id, page_id, page_number, text, extraction_method, text_length, word_count, ocr_used, quality_score, extraction_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveMany = db.transaction(() => {
    deleteExisting.run(pageId);
    const now = new Date().toISOString();
    for (const page of pdfResult.pages) {
      insertPage.run(
        crypto.randomUUID(),
        pageId,
        page.pageNumber,
        page.text,
        page.extractionMethod,
        page.textLength,
        page.wordCount,
        page.ocrUsed ? 1 : 0,
        page.qualityScore,
        page.extractionStatus,
        now
      );
    }
  });

  try {
    saveMany();
  } catch (err) {
    console.warn(`[PDF EXTRACTION DB] Warning saving pdf page details for page ${pageId}:`, err);
  }
}
