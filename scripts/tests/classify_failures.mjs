import { getDb } from '../../src/database/db.js';

const db = getDb();
const jobId = 'df4106b8-e7f4-4cfc-96d2-3c73a660638f';

console.log('==========================================================================');
console.log('CLASSIFYING CRAWL FAILURES IN PERSISTENT JOB df4106b8-e7f4-4cfc-96d2-3c73a660638f');
console.log('==========================================================================\n');

const failedRows = db.prepare(`
  SELECT u.url, u.http_status, u.last_error, e.error_message
  FROM crawl_job_urls u
  LEFT JOIN crawl_errors e ON e.url = u.url AND e.job_id = u.job_id
  WHERE u.job_id = ? AND u.state = 'FAILED'
`).all(jobId);

const counts = {
  http403: 0,
  http404: 0,
  http408: 0,
  http429: 0,
  http5xx: 0,
  timeout: 0,
  connReset: 0,
  fetchFailed: 0,
  tlsNetwork: 0,
  pdfFailure: 0,
  ocrFailure: 0,
  unsupported: 0,
  other: 0
};

const recoverable = [];
const permanent = [];

for (const r of failedRows) {
  const status = r.http_status;
  const msg = `${r.last_error || ''} ${r.error_message || ''}`.toLowerCase();
  const url = r.url;

  let category = 'other';
  let isRecoverable = true;

  if (status === 404) {
    category = 'http404';
    isRecoverable = false;
  } else if (status === 403) {
    category = 'http403';
    isRecoverable = true;
  } else if (status === 408) {
    category = 'http408';
    isRecoverable = true;
  } else if (status === 429) {
    category = 'http429';
    isRecoverable = true;
  } else if (status >= 500 && status < 600) {
    category = 'http5xx';
    isRecoverable = true;
  } else if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('abort')) {
    category = 'timeout';
    isRecoverable = true;
  } else if (msg.includes('econnreset') || msg.includes('connection reset') || msg.includes('socket')) {
    category = 'connReset';
    isRecoverable = true;
  } else if (msg.includes('fetch failed') || msg.includes('failed to fetch')) {
    category = 'fetchFailed';
    isRecoverable = true;
  } else if (msg.includes('tls') || msg.includes('ssl') || msg.includes('certificate') || msg.includes('enotfound')) {
    category = 'tlsNetwork';
    isRecoverable = true;
  } else if (msg.includes('pdf') || msg.includes('pdf_empty_text')) {
    category = 'pdfFailure';
    isRecoverable = true;
  } else if (msg.includes('ocr')) {
    category = 'ocrFailure';
    isRecoverable = true;
  } else if (msg.includes('unsupported') || msg.includes('binary')) {
    category = 'unsupported';
    isRecoverable = false;
  }

  counts[category] = (counts[category] || 0) + 1;

  if (isRecoverable) {
    recoverable.push({ url, status, category, reason: msg });
  } else {
    permanent.push({ url, status, category, reason: msg });
  }
}

console.log('FAILURE CATEGORY BREAKDOWN:');
console.table(counts);
console.log(`\nTotal Failed Rows:    ${failedRows.length}`);
console.log(`Recoverable Failures: ${recoverable.length}`);
console.log(`Permanent Failures:   ${permanent.length}`);
console.log('==========================================================================');
