import crypto from 'crypto';
import dns from 'node:dns';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';
import { getDb } from '../database/db.js';
import { cleanPageContent, extractMeaningfulTitle, detectSectionMetadata } from './contentCleaner.js';
import { chunkStructuredText } from './chunker.js';
import { safeExtractPdfText, extractPdfDocument, savePdfPageExtractions, hasPdfSignature } from './pdfExtractor.js';

const execFileAsync = promisify(execFile);

export interface CrawlOptions {
  startUrl: string;
  maxPages?: number;
  maxDepth?: number;
  timeoutMs?: number;
  type?: 'FULL' | 'INCREMENTAL' | 'RETRY_FAILED';
  retryOnlyUrls?: string[];
}

export interface CrawlResult {
  jobId: string;
  status: 'completed' | 'failed' | 'interrupted';
  discovered: number;
  crawled: number;
  updated: number;
  new: number;
  unchanged: number;
  pdfDocuments: number;
  documentsSkipped: number;
  documentsTooLarge: number;
  chunks: number;
  failed: number;
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
const CANONICAL_HOST = 'necn.ac.in';
const CANONICAL_ORIGIN = 'https://necn.ac.in';
const MAX_FETCH_ATTEMPTS = Math.max(1, Math.min(6, Number(process.env.HTTP_MAX_RETRIES || 3)));
const RETRY_BASE_MS = Math.max(100, Number(process.env.HTTP_RETRY_BACKOFF || 800));
function getMaxDocumentBytes(): number {
  const envMb = Number(process.env.MAX_DOCUMENT_SIZE_MB);
  if (!Number.isFinite(envMb) || envMb < 1) return 25 * 1024 * 1024;
  if (envMb > 100) return 100 * 1024 * 1024;
  return Math.floor(envMb * 1024 * 1024);
}
const MAX_DOCUMENT_BYTES = getMaxDocumentBytes();
const PDF_EXTRACTION_TIMEOUT_MS = Number(process.env.PDF_EXTRACTION_TIMEOUT_MS) || 10_000;
export const CRAWLER_VERSION = 'NECN-CRAWLER-PERSISTENT-V4';
let activeWorkers = 0;

export function crawlerRuntime() { return { crawlerVersion: CRAWLER_VERSION, persistentQueue: true, activeWorkers }; }

export function syncJobMetricsFromUrls(db: any, jobId: string, currentUrl?: string | null) {
  const counts = db.prepare(`
    SELECT
      COUNT(*) as total_discovered,
      COUNT(CASE WHEN state = 'CRAWLED' THEN 1 END) as total_crawled,
      COUNT(CASE WHEN state = 'FAILED' THEN 1 END) as total_failed,
      COUNT(CASE WHEN state = 'SKIPPED' THEN 1 END) as total_skipped,
      COUNT(CASE WHEN state = 'CRAWLING' THEN 1 END) as total_crawling,
      COUNT(CASE WHEN state = 'QUEUED' THEN 1 END) as total_queued
    FROM crawl_job_urls WHERE job_id = ?
  `).get(jobId) as any;

  if (counts && counts.total_discovered > 0) {
    const job = db.prepare("SELECT status FROM crawl_jobs WHERE id = ?").get(jobId) as any;
    let newStatus = job?.status;

    // TERMINAL-STATE RULE:
    // A job may ONLY be 'completed' if total_queued === 0 AND total_crawling === 0.
    // If a job was marked 'completed' while queued > 0 or crawling > 0, correct it to 'interrupted'.
    if ((counts.total_queued > 0 || counts.total_crawling > 0) && newStatus === 'completed') {
      newStatus = 'interrupted';
    }

    db.prepare(`
      UPDATE crawl_jobs
      SET pages_discovered = ?,
          pages_crawled = ?,
          pages_failed = ?,
          documents_skipped = ?,
          status = ?,
          current_url = CASE WHEN ? IS NOT NULL THEN ? ELSE current_url END,
          last_heartbeat_at = ?
      WHERE id = ?
    `).run(
      counts.total_discovered || 0,
      counts.total_crawled || 0,
      counts.total_failed || 0,
      counts.total_skipped || 0,
      newStatus || 'running',
      currentUrl ?? null,
      currentUrl ?? null,
      new Date().toISOString(),
      jobId
    );
  }
  return counts;
}

export function recoverStaleCrawlJobs() {
  const db = getDb();
  const threshold = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const jobs = db.prepare("SELECT id FROM crawl_jobs WHERE status='running' AND (last_heartbeat_at IS NULL OR last_heartbeat_at < ?)").all(threshold) as Array<{id:string}>;
  const recover = db.transaction(() => {
    for (const job of jobs) {
      db.prepare("UPDATE crawl_jobs SET status='interrupted', current_url=NULL, error='Backend stopped; crawl is resumable' WHERE id=?").run(job.id);
      db.prepare("UPDATE crawl_job_urls SET state='QUEUED', started_at=NULL WHERE job_id=? AND state IN ('CRAWLING','DISCOVERED')").run(job.id);
      syncJobMetricsFromUrls(db, job.id, null);
    }
  }); recover(); 
  if (jobs.length > 0) {
    console.log(`[STALE JOB RECOVERY] Recovered ${jobs.length} stale crawl job(s) to interrupted status`);
  }
  return jobs.length;
}
let browserPromise: Promise<any> | null = null;
let browserUnavailable = false;

async function getBrowser(): Promise<any> {
  if (browserUnavailable) return null;
  if (!browserPromise) {
    // Optional dynamic import keeps deployments functional when Chromium is not
    // bundled; the acquisition chain then transparently uses system curl.
    const loadPlaywright = new Function('return import("playwright")') as () => Promise<any>;
    browserPromise = loadPlaywright().then(({ chromium }) => chromium.launch({ headless: true })).catch((error: unknown) => {
      browserPromise = null;
      browserUnavailable = true;
      console.warn(`[CRAWLER] Browser transport unavailable | ${error instanceof Error ? error.message : error}`);
      throw error;
    });
  }
  return browserPromise;
}

// We intentionally DO NOT exclude .pdf. Public NECN PDFs are part of the official
// knowledge dataset (faculty lists, regulations, notices, committees, etc.).
const SKIP_EXTENSIONS = /\.(?:jpg|jpeg|png|gif|webp|svg|ico|mp4|mp3|wav|zip|rar|7z|doc|docx|xls|xlsx|ppt|pptx|css|js|mjs|map|woff|woff2|ttf|eot)$/i;

dns.setDefaultResultOrder('ipv4first');

function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const url = new URL(raw, base);
    url.hash = '';
    // Query parameters are removed to prevent tracking/filter URLs from creating
    // an unbounded crawl. The public NECN modules are path-based.
    url.search = '';
    if (!['http:', 'https:'].includes(url.protocol)) return null;

    const hostname = url.hostname.toLowerCase();
    if (hostname === CANONICAL_HOST || hostname === `www.${CANONICAL_HOST}`) {
      url.protocol = 'https:';
      url.hostname = CANONICAL_HOST;
      url.port = '';
    }

    if (SKIP_EXTENSIONS.test(url.pathname)) return null;
    return url.toString().replace(/\/$/, '') || `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function isAllowedHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === CANONICAL_HOST;
  } catch {
    return false;
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function extractTitle(html: string, url: string): string {
  // Delegate to the chrome-aware title extractor; falls back to URL-derived.
  return extractMeaningfulTitle(html, url);
}

function extractAttributeUrls(html: string, pageUrl: string): string[] {
  const found = new Set<string>();

  // Standard links plus iframe/object/embed/source/link references. This catches
  // public documents that are embedded instead of exposed as normal anchors.
  const attributeRegex = /<(?:a|area|iframe|object|embed|source|link)\b[^>]*?(?:href|src|data)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = attributeRegex.exec(html))) found.add(match[1]);

  // A few older college pages use inline JavaScript navigation instead of hrefs.
  const jsRegex = /(?:location(?:\.href)?|window\.open|document\.location)\s*\(?\s*["']([^"']+)["']/gi;
  while ((match = jsRegex.exec(html))) found.add(match[1]);

  const urls = new Set<string>();
  for (const raw of found) {
    const normalized = normalizeUrl(decodeHtml(raw), pageUrl);
    if (normalized && isAllowedHost(normalized)) urls.add(normalized);
  }
  return [...urls];
}

function extractContent(html: string): string {
  // Use the chrome-aware DOM cleaner. This strips nav/footer/aside/mega-menu
  // containers and converts the surviving HTML to plaintext with structural
  // markers (##H1##, ##TR##, • bullets).
  return cleanPageContent(html, { source: 'crawler' });
}

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
    try { return Buffer.from(even, 'hex').toString('latin1'); } catch { return ''; }
  }
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) return decodePdfLiteral(trimmed.slice(1, -1));
  return '';
}

function extractPdfText(buffer: Buffer): string {
  // Lightweight extractor for ordinary text-based PDFs. It supports the common
  // NECN PDF patterns (plain and Flate-compressed streams, Tj and TJ operators)
  // without adding a native PDF dependency that is troublesome on Windows.
  const binary = buffer.toString('latin1');
  const texts: string[] = [];
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch: RegExpExecArray | null;

  while ((streamMatch = streamRegex.exec(binary))) {
    let stream = Buffer.from(streamMatch[1], 'latin1');
    try { stream = zlib.inflateSync(stream); } catch { /* uncompressed */ }
    const text = stream.toString('latin1');
    if (!/(?:BT|Tj|TJ|Tf)/.test(text)) continue;

    const btBlocks = text.match(/BT([\s\S]*?)ET/g) || [text];
    for (const block of btBlocks) {
      const blockText: string[] = [];
      const tjArray = /\[((?:\\.|\([^)]*\)|<[^>]*>|[^\]])*)\]\s*TJ/g;
      let m: RegExpExecArray | null;
      while ((m = tjArray.exec(block))) {
        const parts = m[1].match(/\([^)]*(?:\\.[^)]*)*\)|<[^>]*>/g) || [];
        for (const part of parts) {
          const decoded = decodePdfString(part);
          if (decoded) blockText.push(decoded);
        }
        blockText.push(' ');
      }

      const tj = /(\([^)]*(?:\\.[^)]*)*\)|<[^>]*>)\s*Tj/g;
      while ((m = tj.exec(block))) {
        const decoded = decodePdfString(m[1]);
        if (decoded) blockText.push(decoded, '\n');
      }
      if (blockText.length) texts.push(blockText.join(''));
    }
  }

  if (!texts.length) {
    const fallback = binary.match(/\((?:\\.|[^)])*\)\s*Tj/g) || [];
    for (const item of fallback) {
      const decoded = decodePdfString(item.replace(/\s*Tj$/, ''));
      if (decoded) texts.push(decoded);
    }
  }

  return texts.join('\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

// PDF parsing happens off the crawl event loop. A malformed PDF therefore
// cannot freeze the queue; its worker is terminated after the hard limit.
function extractPdfTextWithTimeout(buffer: Buffer): Promise<string> {
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    const input = Buffer.from(workerData).toString('latin1');
    const decode = s => s.replace(/\\\\([nrtbf\\\\()])/g, (_, c) => ({n:'\\n',r:'\\r',t:'\\t',b:'\\b',f:'\\f','\\\\':'\\\\','(':'(',')':')'}[c] || c));
    const out = []; let match; const re = /\\(([^()\\\\]{0,4000})\\)\\s*Tj/g;
    while ((match = re.exec(input)) && out.length < 200000) out.push(decode(match[1]));
    parentPort.postMessage(out.join('\\n'));
  `;
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, { eval: true, workerData: buffer });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('PDF text extraction timed out after 60 seconds'));
    }, PDF_EXTRACTION_TIMEOUT_MS);
    worker.once('message', value => { clearTimeout(timer); void worker.terminate(); resolve(String(value || '')); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

function titleFromUrl(url: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'NECN Document');
    return name.replace(/\.(?:pdf)$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'NECN Official Document';
  } catch {
    return 'NECN Official Document';
  }
}

function makeChunks(content: string): Array<{ heading: string; content: string; index: number }> {
  // Delegate to the heading-aware, structure-preserving chunker.
  return chunkStructuredText(content).map(c => ({ heading: c.heading, content: c.content, index: c.index }));
}

function keywordsFor(content: string): string {
  const stop = new Set([
    'the','and','for','with','from','that','this','are','was','were','has','have','will','into','your','their','about',
    'college','engineering','department','professor','assistant','associate'
  ]);
  const counts = new Map<string, number>();
  for (const token of content.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []) {
    if (stop.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([k]) => k).join(',');
}

function pageCategory(url: string, title: string): string {
  const value = `${url} ${title}`.toLowerCase();
  if (/admission|course|eligib/.test(value)) return 'Admissions';
  if (/placement|career|training/.test(value)) return 'Placements';
  if (/research|publication|patent/.test(value)) return 'Research';
  if (/department|cse|ece|eee|mechanical|civil|mba|mca|fed|hs/.test(value)) return 'Departments';
  if (/academic|syllabus|regulation|calendar|examination/.test(value)) return 'Academics';
  if (/alumni/.test(value)) return 'Alumni';
  if (/iqac|naac|nba|accredit/.test(value)) return 'Accreditation & IQAC';
  if (/campus|hostel|library|club|facility/.test(value)) return 'Campus Life';
  if (/pdf|notice|committee|policy|report/.test(value)) return 'Official Documents';
  return 'General';
}

type CrawlerResponse = {
  status: number;
  ok: boolean;
  url: string;
  headers: Headers;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

function responseFromBuffer(status: number, url: string, headers: Headers, body: Buffer): CrawlerResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    headers,
    async text() { return body.toString('utf8'); },
    async arrayBuffer() {
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    }
  };
}

async function readDocumentWithinLimit(response: CrawlerResponse): Promise<Buffer> {
  const stream = (response as any).body;
  if (!stream?.getReader) return Buffer.from(await response.arrayBuffer());
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOCUMENT_BYTES) {
        await reader.cancel('Document exceeds 25 MB safety limit');
        throw new Error('DOCUMENT_TOO_LARGE');
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts.map(part => Buffer.from(part)));
}

/** Browser navigation is the primary HTML acquisition path.  It sees the same
 * rendered DOM a visitor sees, including JavaScript generated navigation. */
async function fetchWithBrowser(url: string, timeoutMs: number): Promise<CrawlerResponse | null> {
  if (browserUnavailable) return null;
  let page: any;
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({ userAgent: USER_AGENT, locale: 'en-US' });
    page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    await page.waitForTimeout(250);
    const finalUrl = page.url();
    if (!isAllowedHost(finalUrl)) return null;
    const responseHeaders = new Headers(response?.headers?.() || {});
    const contentType = (responseHeaders.get('content-type') || '').toLowerCase();
    // PDF navigation is acquired by curl below so the original bytes are retained.
    if (contentType.includes('application/pdf')) return null;
    const html = await page.content();
    return responseFromBuffer(response?.status?.() || 200, finalUrl, responseHeaders, Buffer.from(html, 'utf8'));
  } catch (error) {
    console.warn(`[CRAWLER] Browser transport failed ${url} | ${error instanceof Error ? error.message : error}`);
    return null;
  } finally {
    await page?.context()?.close().catch(() => {});
  }
}

function parseCurlHeaders(raw: string): { status: number; headers: Headers } {
  // curl may record multiple header blocks when redirects happen. Use the final
  // HTTP response block.
  const blocks = raw
    .split(/\r?\n\r?\n/)
    .map(block => block.trim())
    .filter(block => /^HTTP\/\d(?:\.\d)?\s+\d+/i.test(block));
  const block = blocks[blocks.length - 1] || '';
  const lines = block.split(/\r?\n/);
  const statusMatch = lines[0]?.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/i);
  const headers = new Headers();
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    headers.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  return { status: statusMatch ? Number(statusMatch[1]) : 0, headers };
}

async function fetchWithCurl(
  url: string,
  timeoutMs: number,
  conditional?: { etag?: string | null; lastModified?: string | null }
): Promise<CrawlerResponse | null> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'necn-crawl-'));
  const bodyFile = path.join(tempDir, 'body.bin');
  const headerFile = path.join(tempDir, 'headers.txt');
  const finalUrlFile = path.join(tempDir, 'final-url.txt');

  try {
    const args = [
      '--ipv4',
      '--location',
      '--silent',
      '--show-error',
      '--compressed',
      '--max-time', String(Math.max(45, Math.ceil(timeoutMs / 1000))),
      '--connect-timeout', '15',
      '--retry', '2',
      '--retry-delay', '1',
      // Prevent one unusually large public document from monopolising the
      // single crawl worker. It is recorded as a retriable acquisition failure.
      '--max-filesize', String(MAX_DOCUMENT_BYTES),
      '--user-agent', USER_AGENT,
      '--header', 'Accept: text/html,application/xhtml+xml,application/xml,text/xml,application/pdf;q=0.95,*/*;q=0.5',
      '--header', 'Accept-Language: en-US,en;q=0.9',
      '--dump-header', headerFile,
      '--output', bodyFile,
      '--write-out', '%{url_effective}',
      url
    ];

    if (conditional?.etag) {
      args.splice(args.length - 1, 0, '--header', `If-None-Match: ${conditional.etag}`);
    }
    if (conditional?.lastModified) {
      args.splice(args.length - 1, 0, '--header', `If-Modified-Since: ${conditional.lastModified}`);
    }

    const executable = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const { stdout } = await execFileAsync(executable, args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });

    await fs.promises.writeFile(finalUrlFile, String(stdout || ''), 'utf8');
    const [headerRaw, body, finalUrlRaw] = await Promise.all([
      fs.promises.readFile(headerFile, 'utf8'),
      fs.promises.readFile(bodyFile),
      fs.promises.readFile(finalUrlFile, 'utf8')
    ]);

    const parsed = parseCurlHeaders(headerRaw);
    const finalUrl = String(finalUrlRaw || url).trim() || url;

    let finalHost = '';
    try {
      finalHost = new URL(finalUrl).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return null;
    }
    if (finalHost !== CANONICAL_HOST) {
      console.warn(`[CRAWLER] curl rejected redirect outside official host: ${url} -> ${finalUrl}`);
      return null;
    }

    if (!parsed.status) {
      console.warn(`[CRAWLER] curl returned no HTTP status for ${url}`);
      return null;
    }

    return responseFromBuffer(parsed.status, finalUrl, parsed.headers, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[CRAWLER] curl transport failed ${url} | ${message}`);
    return null;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function fetchText(
  url: string,
  timeoutMs: number,
  conditional?: { etag?: string | null; lastModified?: string | null }
): Promise<CrawlerResponse | null> {
  let lastMessage = '';

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml,text/xml,application/pdf;q=0.95,*/*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.9',
      };
      if (conditional?.etag) headers['If-None-Match'] = conditional.etag;
      if (conditional?.lastModified) headers['If-Modified-Since'] = conditional.lastModified;

      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow'
      });

      const finalHost = new URL(response.url).hostname.toLowerCase().replace(/^www\./, '');
      if (finalHost !== CANONICAL_HOST) {
        console.warn(`[CRAWLER] Rejected redirect outside official host: ${url} -> ${response.url}`);
        return null;
      }

      // NECN's edge/origin can return 5xx to Node's fetch while the same public
      // page is available through the system curl client (the same transport
      // users can verify from Windows CMD). Fall back to curl before giving up.
      if (response.status >= 500) {
        console.warn(`[CRAWLER] Native fetch returned ${response.status} for ${url}; trying curl fallback.`);
        const curlResponse = await fetchWithCurl(url, timeoutMs, conditional);
        if (curlResponse) return curlResponse;
      }

      return response;
    } catch (error) {
      lastMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.warn(`[CRAWLER] Attempt ${attempt}/${MAX_FETCH_ATTEMPTS} failed ${url} | ${lastMessage}`);

      // Try the system curl transport immediately after a native fetch error.
      const curlResponse = await fetchWithCurl(url, timeoutMs, conditional);
      if (curlResponse) return curlResponse;

      if (attempt < MAX_FETCH_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, RETRY_BASE_MS * attempt));
      }
    }
  }

  // Browser is a bounded last-resort fallback only. Missing Playwright is
  // explicitly unavailable and never prevents the URL from reaching a
  // terminal FAILED/SKIPPED state in the caller.
  if (!conditional?.etag && !conditional?.lastModified && !browserUnavailable) {
    const browserResponse = await fetchWithBrowser(url, timeoutMs);
    if (browserResponse) return browserResponse;
  }

  console.warn(`[CRAWLER] All transports failed for ${url} | ${lastMessage}`);
  return null;
}

async function discoverSitemapUrls(timeoutMs: number): Promise<string[]> {
  const candidates = new Set<string>([
    `${CANONICAL_ORIGIN}/sitemap.xml`,
    `${CANONICAL_ORIGIN}/sitemap_index.xml`,
    `${CANONICAL_ORIGIN}/sitemap-index.xml`
  ]);

  // NECN is a legacy-style college site and publishes a human-readable site map.
  // Keep this as a bootstrap source as well as XML sitemap discovery. It makes
  // the crawler resilient when the homepage is temporarily unavailable or
  // protected by an edge layer while the site-map page remains reachable.
  const siteMapPages = [
    `${CANONICAL_ORIGIN}/site-map.php`,
    `${CANONICAL_ORIGIN}/sitemap.php`,
    `${CANONICAL_ORIGIN}/site-map.html`
  ];
  const htmlDiscovered = new Set<string>();
  for (const siteMapUrl of siteMapPages) {
    const response = await fetchText(siteMapUrl, timeoutMs);
    if (!response?.ok) continue;
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('html')) continue;
    const html = await response.text();
    for (const url of extractAttributeUrls(html, siteMapUrl)) htmlDiscovered.add(url);
  }
  if (htmlDiscovered.size) {
    console.log(`[CRAWLER] Human-readable site map discovery found ${htmlDiscovered.size} official URLs.`);
  }

  const robots = await fetchText(`${CANONICAL_ORIGIN}/robots.txt`, timeoutMs);
  if (robots?.ok) {
    const text = await robots.text();
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*sitemap:\s*(\S+)/i);
      if (match) {
        const normalized = normalizeUrl(match[1]);
        if (normalized && isAllowedHost(normalized)) candidates.add(normalized);
      }
    }
  }

  const sitemapQueue = [...candidates];
  const visited = new Set<string>();
  const discovered = new Set<string>();

  while (sitemapQueue.length && visited.size < 100) {
    const sitemap = sitemapQueue.shift()!;
    if (visited.has(sitemap)) continue;
    visited.add(sitemap);

    const response = await fetchText(sitemap, timeoutMs);
    if (!response?.ok) continue;
    const xml = await response.text();

    const locs = [...xml.matchAll(/<loc[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi)]
      .map(m => decodeHtml(m[1].trim()))
      .filter(Boolean);

    for (const loc of locs) {
      const normalized = normalizeUrl(loc, sitemap);
      if (!normalized || !isAllowedHost(normalized)) continue;
      if (/sitemap(?:[_-]index)?\.xml$/i.test(normalized) || /sitemap/i.test(new URL(normalized).pathname) && normalized.endsWith('.xml')) {
        if (!visited.has(normalized)) sitemapQueue.push(normalized);
      } else {
        discovered.add(normalized);
      }
    }
  }

  for (const url of htmlDiscovered) discovered.add(url);
  console.log(`[CRAWLER] Sitemap discovery found ${discovered.size} official URLs.`);
  return [...discovered];
}

export async function crawlWebsite(options: CrawlOptions): Promise<CrawlResult> {
  activeWorkers++;
  const db = getDb();
  const startUrl = normalizeUrl(options.startUrl || CANONICAL_ORIGIN);
  if (!startUrl || !isAllowedHost(startUrl)) throw new Error(`Invalid NECN crawl URL. Use ${CANONICAL_ORIGIN}`);

  // 0 means genuinely unlimited. The queue is bounded only by the discoverable
  // official site graph, not an arbitrary implementation ceiling.
  const requestedMax = Number(options.maxPages ?? 0);
  const maxPages = requestedMax <= 0 ? Number.POSITIVE_INFINITY : Math.max(1, requestedMax);
  const maxDepth = options.maxDepth && options.maxDepth > 0 ? options.maxDepth : Number.POSITIVE_INFINITY;
  const timeoutMs = Math.max(10000, Math.min(options.timeoutMs ?? 30000, 60000));
  const jobType = options.type || 'FULL';

  console.log(`[CRAWLER] Performing preflight host connectivity check for ${CANONICAL_ORIGIN}...`);
  const preflightRes = await fetchText(CANONICAL_ORIGIN, 15000);
  if (!preflightRes) {
    console.warn(`[CRAWLER] PREFLIGHT WARNING: Native fetch to ${CANONICAL_ORIGIN} failed. Verifying with curl fallback...`);
    const preflightCurl = await fetchWithCurl(CANONICAL_ORIGIN, 20000);
    if (!preflightCurl) {
      throw new Error(`HOST_CONNECTIVITY_FAILURE: Cannot connect to ${CANONICAL_ORIGIN} via Node fetch or curl transport. Check host availability.`);
    }
  }
  console.log(`[CRAWLER] Host connectivity successfully verified for ${CANONICAL_ORIGIN}.`);

  // Check if there's an existing running job to resume
  const existingJob = db.prepare("SELECT id, start_url, pages_crawled, pages_updated, pages_failed, pages_new, pages_unchanged, pdf_documents, chunks_created, documents_skipped, documents_too_large FROM crawl_jobs WHERE status='running' ORDER BY started_at DESC LIMIT 1").get() as any;
  
  let jobId: string;
  let startedAt: string;
  let crawled = 0, updated = 0, failed = 0, created = 0, unchanged = 0, pdfDocuments = 0, chunkCount = 0, documentsSkipped = 0, documentsTooLarge = 0;
  
  if (existingJob) {
    // Resume existing job
    jobId = existingJob.id;
    startedAt = existingJob.started_at || new Date().toISOString();
    crawled = existingJob.pages_crawled || 0;
    updated = existingJob.pages_updated || 0;
    failed = existingJob.pages_failed || 0;
    created = existingJob.pages_new || 0;
    unchanged = existingJob.pages_unchanged || 0;
    pdfDocuments = existingJob.pdf_documents || 0;
    chunkCount = existingJob.chunks_created || 0;
    documentsSkipped = existingJob.documents_skipped || 0;
    documentsTooLarge = existingJob.documents_too_large || 0;
    console.log(`[CRAWLER] Resuming existing job ${jobId} with ${crawled} pages already crawled`);
  } else {
    // Create new job
    jobId = crypto.randomUUID();
    startedAt = new Date().toISOString();
    db.prepare(`INSERT INTO crawl_jobs (id, started_at, last_heartbeat_at, start_url, job_type, status) VALUES (?, ?, ?, ?, ?, 'running')`).run(jobId, startedAt, startedAt, startUrl, jobType);
  }
  
  const queueUrl = db.prepare(`INSERT OR IGNORE INTO crawl_job_urls (id,job_id,url,depth,state) VALUES (?,?,?,?, 'QUEUED')`);
  const setUrlState = db.prepare(`UPDATE crawl_job_urls SET state=?, http_status=COALESCE(?,http_status), mime_type=COALESCE(?,mime_type), content_length=COALESCE(?,content_length), last_error=?, completed_at=CASE WHEN ? IN ('CRAWLED','FAILED','SKIPPED') THEN ? ELSE completed_at END WHERE job_id=? AND url=?`);

  const retryOnly = options.retryOnlyUrls?.map(url => normalizeUrl(url)).filter((url): url is string => Boolean(url)) || [];
  let queue: Array<{ url: string; depth: number }>;
  let queued: Set<string>;
  
  if (existingJob) {
    // Load queue and all known URLs for existing job
    const queuedUrls = db.prepare("SELECT url, depth FROM crawl_job_urls WHERE job_id=? AND state='QUEUED'").all(jobId) as Array<{url:string, depth:number}>;
    const allUrls = db.prepare("SELECT url FROM crawl_job_urls WHERE job_id=?").all(jobId) as Array<{url:string}>;
    queue = queuedUrls;
    queued = new Set(allUrls.map(item => item.url));
    syncJobMetricsFromUrls(db, jobId, null);
    console.log(`[CRAWLER] Loaded ${queue.length} queued URLs from persistent queue (Total Discovered: ${queued.size})`);
  } else {
    // Create new queue
    queue = retryOnly.length
      ? retryOnly.map(url => ({ url, depth: 0 })) : [{ url: startUrl, depth: 0 }];
    queued = new Set(queue.map(item => item.url));
    for (const item of queue) queueUrl.run(crypto.randomUUID(), jobId, item.url, item.depth);
    if (!retryOnly.length) {
      const sitemapUrls = await discoverSitemapUrls(timeoutMs);
      console.log(`[CRAWLER] Bootstrap discovery returned ${sitemapUrls.length} official URLs.`);
      for (const url of sitemapUrls) {
        if (!queued.has(url)) {
          queued.add(url);
          queue.push({ url, depth: 0 });
          queueUrl.run(crypto.randomUUID(), jobId, url, 0);
        }
      }
    }
    syncJobMetricsFromUrls(db, jobId, null);
  }

  const seenThisRun = new Set<string>();
  const failureReasons: string[] = [];

  try {
    while (queue.length && crawled < maxPages) {
      const current = queue.shift()!;
      db.prepare(`UPDATE crawl_job_urls SET state='CRAWLING', attempts=attempts+1, started_at=? WHERE job_id=? AND url=?`)
        .run(new Date().toISOString(), jobId, current.url);
      syncJobMetricsFromUrls(db, jobId, current.url);
      try {
      const known = db.prepare('SELECT etag, last_modified FROM website_pages WHERE url = ?').get(current.url) as any;
      const response = await fetchText(current.url, timeoutMs, { etag: known?.etag, lastModified: known?.last_modified });

      if (!response) {
        failed++;
        failureReasons.push(`${current.url}: no response from Node fetch or curl transport`);
        db.prepare(`INSERT INTO crawl_errors (id,job_id,url,http_status,error_message,stage,retry_count,created_at)
          VALUES (?,?,?,?,?,?,1,?)`).run(crypto.randomUUID(), jobId, current.url, null, 'No browser, Node fetch, or curl response', 'acquisition', new Date().toISOString());
        setUrlState.run('FAILED', null, null, null, 'No acquisition response', 'FAILED', new Date().toISOString(), jobId, current.url);
        continue;
      }

      crawled++;
      db.prepare(`UPDATE crawl_jobs SET pages_discovered=?, pages_crawled=?, pages_updated=?, pages_failed=? WHERE id=?`)
        .run(queued.size, crawled, updated, failed, jobId);
      console.log(`[CRAWLER] ${response.status} ${current.url}`);

      if (response.status === 304) {
        db.prepare('UPDATE website_pages SET last_crawled = ? WHERE url = ?').run(new Date().toISOString(), current.url);
        seenThisRun.add(current.url);
        unchanged++;
        setUrlState.run('CRAWLED', response.status, null, null, null, 'CRAWLED', new Date().toISOString(), jobId, current.url);
        continue;
      }
      if (!response.ok) {
        failed++;
        failureReasons.push(`${current.url}: HTTP ${response.status}`);
        db.prepare(`INSERT INTO crawl_errors (id,job_id,url,http_status,error_message,stage,retry_count,created_at)
          VALUES (?,?,?,?,?,?,1,?)`).run(crypto.randomUUID(), jobId, current.url, response.status, `HTTP ${response.status}`, 'acquisition', new Date().toISOString());
        db.prepare(`UPDATE crawl_jobs SET pages_discovered=?, pages_crawled=?, pages_updated=?, pages_failed=? WHERE id=?`)
          .run(queued.size, crawled, updated, failed, jobId);
        setUrlState.run('FAILED', response.status, null, null, `HTTP ${response.status}`, 'FAILED', new Date().toISOString(), jobId, current.url);
        continue;
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const finalUrl = normalizeUrl(response.url) || current.url;
      const isPdf = contentType.includes('application/pdf') || /\.pdf$/i.test(new URL(finalUrl).pathname);
      let html = '';
      let title = finalUrl;
      let content = '';

      if (isPdf) {
        const declaredSize = Number(response.headers.get('content-length') || 0);
        if (declaredSize > MAX_DOCUMENT_BYTES) {
          documentsSkipped++;
          documentsTooLarge++;
          db.prepare(`INSERT INTO crawl_errors (id,job_id,url,http_status,error_message,stage,retry_count,created_at)
            VALUES (?,?,?,?,?,?,0,?)`).run(crypto.randomUUID(), jobId, finalUrl, response.status, `skipped_due_to_size: ${declaredSize} bytes exceeds ${MAX_DOCUMENT_BYTES}`, 'skipped_due_to_size', new Date().toISOString());
          setUrlState.run('SKIPPED', response.status, contentType, declaredSize, 'skipped_due_to_size', 'SKIPPED', new Date().toISOString(), jobId, current.url);
          continue;
        }
        let buffer: Buffer;
        try { buffer = await readDocumentWithinLimit(response); }
        catch (error) {
          if (error instanceof Error && error.message === 'DOCUMENT_TOO_LARGE') {
            documentsSkipped++; documentsTooLarge++;
            db.prepare(`INSERT INTO crawl_errors (id,job_id,url,http_status,error_message,stage,retry_count,created_at)
            VALUES (?,?,?,?,?,?,0,?)`).run(crypto.randomUUID(), jobId, finalUrl, response.status, `skipped_due_to_size: streamed document exceeded ${MAX_DOCUMENT_BYTES} bytes`, 'skipped_due_to_size', new Date().toISOString());
            setUrlState.run('SKIPPED', response.status, contentType, null, 'skipped_due_to_size', 'SKIPPED', new Date().toISOString(), jobId, current.url);
            continue;
          }
          throw error;
        }
        if (buffer.length > MAX_DOCUMENT_BYTES) {
          documentsSkipped++;
          documentsTooLarge++;
          db.prepare(`INSERT INTO crawl_errors (id,job_id,url,http_status,error_message,stage,retry_count,created_at)
          VALUES (?,?,?,?,?,?,0,?)`).run(crypto.randomUUID(), jobId, finalUrl, response.status, `skipped_due_to_size: streamed document exceeded ${MAX_DOCUMENT_BYTES} bytes`, 'skipped_due_to_size', new Date().toISOString());
          setUrlState.run('SKIPPED', response.status, contentType, buffer.length, 'skipped_due_to_size', 'SKIPPED', new Date().toISOString(), jobId, current.url);
          continue;
        }
        title = titleFromUrl(finalUrl);
        // Validate the magic bytes before extracting — random bytes often look
        // like garbage text otherwise.
        if (!hasPdfSignature(buffer)) {
          failed++;
          failureReasons.push(`${finalUrl}: not a valid PDF (missing %PDF- header)`);
          db.prepare(`INSERT INTO crawl_errors (id,job_id,url,http_status,error_message,stage,retry_count,created_at)
          VALUES (?,?,?,?,?,?,1,?)`).run(crypto.randomUUID(), jobId, finalUrl, response.status, 'invalid_pdf_signature', 'pdf_extraction', new Date().toISOString());
          setUrlState.run('FAILED', response.status, contentType, buffer.length, 'invalid_pdf_signature', 'FAILED', new Date().toISOString(), jobId, current.url);
          continue;
        }
        const pdfResult = await extractPdfDocument(buffer, { maxMs: PDF_EXTRACTION_TIMEOUT_MS });
        console.log(`[CRAWLER][PDF] ${finalUrl} size=${buffer.length} durationMs=${pdfResult.durationMs} status=${pdfResult.extractionStatus} pages=${pdfResult.pageCount} textLength=${pdfResult.textLength} score=${pdfResult.qualityScore}`);
        if (!pdfResult.ok && pdfResult.textLength < 40) {
          failed++;
          failureReasons.push(`${finalUrl}: pdf_extraction=${pdfResult.reason || pdfResult.extractionStatus}`);
          db.prepare(`INSERT INTO crawl_errors (id,job_id,url,http_status,error_message,stage,retry_count,created_at)
          VALUES (?,?,?,?,?,?,1,?)`).run(crypto.randomUUID(), jobId, finalUrl, response.status, pdfResult.reason || pdfResult.extractionStatus, 'pdf_extraction', new Date().toISOString());
          setUrlState.run('FAILED', response.status, contentType, buffer.length, pdfResult.reason || pdfResult.extractionStatus, 'FAILED', new Date().toISOString(), jobId, current.url);
          continue;
        }
        content = pdfResult.fullText;
        if (pdfResult.title && pdfResult.title !== 'NECN Official Document' && pdfResult.title !== 'Corrupted PDF') {
          title = pdfResult.title;
        }
        pdfDocuments++;
      } else if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
        // Bound HTML downloads as well as PDFs. A single unexpectedly large
        // response must not retain memory or block the full-site queue.
        const htmlBuffer = await readDocumentWithinLimit(response);
        html = htmlBuffer.toString('utf8');
        title = extractTitle(html, finalUrl) || finalUrl;
        content = extractContent(html);
        if (content.length < 40) {
          failed++;
          failureReasons.push(`${finalUrl}: HTML content extraction returned less than 40 characters`);
          db.prepare(`UPDATE crawl_jobs SET pages_discovered=?, pages_crawled=?, pages_updated=?, pages_failed=? WHERE id=?`)
            .run(queued.size, crawled, updated, failed, jobId);
          setUrlState.run('FAILED', response.status, contentType, null, 'HTML content extraction returned less than 40 characters', 'FAILED', new Date().toISOString(), jobId, current.url);
          continue;
        }
      } else {
        // We don't index binary assets such as images, CSS, JS, fonts, etc.
        setUrlState.run('SKIPPED', response.status, contentType, Number(response.headers.get('content-length') || 0) || null, 'unsupported_content_type', 'SKIPPED', new Date().toISOString(), jobId, current.url);
        continue;
      }

      const sectionMeta = detectSectionMetadata(finalUrl, html || content);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      const existing = db.prepare('SELECT id, content_hash, etag, last_modified, last_changed FROM website_pages WHERE url = ?').get(finalUrl) as any;
      const pageId = existing?.id || crypto.randomUUID();
      const changed = !existing || existing.content_hash !== hash;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO website_pages (id,url,title,category,content,content_hash,http_status,content_type,last_crawled,last_changed,is_active,etag,last_modified,section,department,clean_title,clean_content_hash)
        VALUES (@id,@url,@title,@category,@content,@content_hash,@http_status,@content_type,@last_crawled,@last_changed,1,@etag,@last_modified,@section,@department,@clean_title,@clean_content_hash)
        ON CONFLICT(url) DO UPDATE SET
          title=excluded.title, category=excluded.category, content=excluded.content,
          content_hash=excluded.content_hash, http_status=excluded.http_status,
          content_type=excluded.content_type, last_crawled=excluded.last_crawled,
          etag=excluded.etag, last_modified=excluded.last_modified,
          last_changed=CASE WHEN website_pages.content_hash != excluded.content_hash THEN excluded.last_changed ELSE website_pages.last_changed END,
          is_active=1,
          section=excluded.section, department=excluded.department,
          clean_title=excluded.clean_title, clean_content_hash=excluded.clean_content_hash
      `).run({
        id: pageId, url: finalUrl, title, category: pageCategory(finalUrl, title), content,
        content_hash: hash, http_status: response.status, content_type: contentType,
        last_crawled: now, last_changed: changed ? now : (existing?.last_changed || now),
        etag: response.headers.get('etag') || existing?.etag || null,
        last_modified: response.headers.get('last-modified') || existing?.last_modified || null,
        section: sectionMeta.section, department: sectionMeta.department,
        clean_title: title, clean_content_hash: hash
      });

      if (isPdf) {
        savePdfPageExtractions(db, pageId, pdfResult);
      }

      if (changed) {
        db.prepare('DELETE FROM website_chunks WHERE page_id = ?').run(pageId);
        const insertChunk = db.prepare(`INSERT INTO website_chunks (id,page_id,heading,content,chunk_index,keywords,section,department,start_offset,end_offset,chunk_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
        const chunks = makeChunks(content);
        const insertMany = db.transaction(() => {
          for (const chunk of chunks) {
            insertChunk.run(
              crypto.randomUUID(), pageId, chunk.heading, chunk.content, chunk.index,
              keywordsFor(`${title} ${chunk.content}`),
              sectionMeta.section, sectionMeta.department,
              (chunk as any).startOffset ?? null, (chunk as any).endOffset ?? null,
              crypto.createHash('sha256').update(chunk.content).digest('hex').slice(0,16),
              new Date().toISOString()
            );
          }
        });
        insertMany();
        updated++;
        if (!existing) created++;
        chunkCount += chunks.length;
      } else {
        unchanged++;
      }
      seenThisRun.add(finalUrl);
      setUrlState.run('CRAWLED', response.status, contentType, Number(response.headers.get('content-length') || 0) || null, null, 'CRAWLED', new Date().toISOString(), jobId, current.url);
      syncJobMetricsFromUrls(db, jobId, current.url);

      // HTML is the graph of the website. PDFs are leaf documents. We only
      // discover child URLs from HTML so a PDF can never create crawl noise.
      if (!isPdf && current.depth < maxDepth) {
        for (const link of extractAttributeUrls(html, finalUrl)) {
          if (!queued.has(link) && queued.size < maxPages) {
            queued.add(link);
            queue.push({ url: link, depth: current.depth + 1 });
            queueUrl.run(crypto.randomUUID(), jobId, link, current.depth + 1);
            syncJobMetricsFromUrls(db, jobId, current.url);
          }
        }
      }
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        failureReasons.push(`${current.url}: ${message}`);
        db.prepare(`INSERT INTO crawl_errors (id,job_id,url,http_status,error_message,stage,retry_count,created_at)
          VALUES (?,?,?,?,?,?,1,?)`).run(crypto.randomUUID(), jobId, current.url, null, message, 'processing', new Date().toISOString());
        setUrlState.run('FAILED', null, null, null, message, 'FAILED', new Date().toISOString(), jobId, current.url);
        syncJobMetricsFromUrls(db, jobId, current.url);
      }
    }

    const completedAt = new Date().toISOString();
    const diagnostic = failureReasons.length
      ? failureReasons.slice(0, 8).join(' | ')
      : null;
    // A full/incremental discovery run also detects pages no longer reachable
    // from the official site. They remain auditable but leave retrieval.
    if (!retryOnly.length) {
      const stale = db.prepare('SELECT id, url FROM website_pages WHERE is_active=1').all() as Array<{ id: string; url: string }>;
      const deactivate = db.prepare('UPDATE website_pages SET is_active=0 WHERE url=?');
      const deleteChunks = db.prepare('DELETE FROM website_chunks WHERE page_id=?');
      const deactivateMany = db.transaction(() => {
        for (const row of stale) {
          if (!seenThisRun.has(row.url)) {
            deactivate.run(row.url);
            deleteChunks.run(row.id);
          }
        }
      });
      deactivateMany();
    }
    const finalCounts = syncJobMetricsFromUrls(db, jobId, null);
    const isTerminalCompleted = (finalCounts.total_queued === 0 && finalCounts.total_crawling === 0) && finalCounts.total_discovered > 0;
    const finalStatus: 'completed' | 'interrupted' = isTerminalCompleted ? 'completed' : 'interrupted';
    const finalError = isTerminalCompleted
      ? diagnostic
      : (diagnostic ? `${diagnostic} | Interrupted with ${finalCounts.total_queued} URLs queued` : `Crawl paused or reached page limit with ${finalCounts.total_queued} URLs queued; resumable`);

    db.prepare(`UPDATE crawl_jobs SET completed_at=?, current_url=NULL, pages_new=?, pages_unchanged=?, pdf_documents=?, chunks_created=?, documents_too_large=?, status=?, error=? WHERE id=?`)
      .run(completedAt, created, unchanged, pdfDocuments, chunkCount, documentsTooLarge, finalStatus, finalError, jobId);
    console.log(`[WEBSITE SYNC] ${finalStatus.toUpperCase()}: discovered=${finalCounts.total_discovered}, crawled=${finalCounts.total_crawled}, updated=${updated}, failed=${finalCounts.total_failed}, queued=${finalCounts.total_queued}.`);
    if (diagnostic) console.warn(`[WEBSITE SYNC] Diagnostics: ${diagnostic}`);
    return {
      jobId,
      status: finalStatus,
      discovered: finalCounts.total_discovered,
      crawled: finalCounts.total_crawled,
      updated,
      new: created,
      unchanged,
      failed: finalCounts.total_failed,
      pdfDocuments,
      documentsSkipped: finalCounts.total_skipped,
      documentsTooLarge,
      chunks: chunkCount
    };
  } catch (error) {
    const errCounts = syncJobMetricsFromUrls(db, jobId, null);
    db.prepare(`UPDATE crawl_jobs SET completed_at=?, current_url=NULL, status='failed', error=? WHERE id=?`)
      .run(new Date().toISOString(), String(error), jobId);
    throw error;
  } finally {
    activeWorkers = Math.max(0, activeWorkers - 1);
  }
}
