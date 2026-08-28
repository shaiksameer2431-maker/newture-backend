import { getDb } from '../../src/database/db.js';
import fs from 'node:fs';
import path from 'node:path';

const db = getDb();
const jobId = 'df4106b8-e7f4-4cfc-96d2-3c73a660638f';

const backendDir = path.resolve(process.cwd());
const reportsDir = path.join(backendDir, 'artifacts/reports');
const logsDir = path.join(backendDir, 'artifacts/logs');

fs.mkdirSync(reportsDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

const failedRows = db.prepare(`
  SELECT u.url, u.http_status, u.last_error, e.error_message, u.completed_at
  FROM crawl_job_urls u
  LEFT JOIN crawl_errors e ON e.url = u.url AND e.job_id = u.job_id
  WHERE u.job_id = ? AND u.state = 'FAILED'
`).all(jobId);

const reportMd = `# NECN Ingestion Failure Analysis Report

**Date**: ${new Date().toISOString()}  
**Job ID**: ${jobId}  

---

## 1. Summary Metrics

- **Total Discovered URLs**: ${db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ?").get(jobId).n}
- **Successfully Crawled**: ${db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state = 'CRAWLED' AND http_status = 200").get(jobId).n}
- **Permanent Failures (404)**: ${failedRows.filter(r => r.http_status === 404).length}
- **Remaining Pending Queue**: ${db.prepare("SELECT COUNT(*) n FROM crawl_job_urls WHERE job_id = ? AND state IN ('QUEUED', 'CRAWLING')").get(jobId).n}

---

## 2. Permanent Failure Log (HTTP 404 / Non-Existent Pages)

${failedRows.filter(r => r.http_status === 404).map(r => `- **URL**: \`${r.url}\` | Status: 404 Not Found`).join('\n') || 'None'}

---

## 3. Detailed Failure Inventory

${failedRows.map(r => `- **URL**: \`${r.url}\` | Status: ${r.http_status || 'N/A'} | Error: ${r.last_error || r.error_message || 'None'}`).join('\n')}
`;

fs.writeFileSync(path.join(reportsDir, 'FAILURE_ANALYSIS_REPORT.md'), reportMd, 'utf8');
fs.writeFileSync(path.join(logsDir, 'failed_urls.json'), JSON.stringify(failedRows, null, 2), 'utf8');

console.log('Saved failure report to artifacts/reports/FAILURE_ANALYSIS_REPORT.md');
console.log('Saved failed URLs JSON log to artifacts/logs/failed_urls.json');
