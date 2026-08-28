import { getDb } from '../../src/database/db.js';

const db = getDb();
const jobId = 'df4106b8-e7f4-4cfc-96d2-3c73a660638f';

console.log('==========================================================================');
console.log('RE-QUEUING RECOVERABLE FAILURES IN JOB df4106b8-e7f4-4cfc-96d2-3c73a660638f');
console.log('==========================================================================\n');

// Find all failed URLs EXCEPT permanent 404s
const recoverableRows = db.prepare(`
  SELECT url FROM crawl_job_urls
  WHERE job_id = ? AND state = 'FAILED' AND (http_status IS NULL OR http_status <> 404)
`).all(jobId);

console.log(`Found ${recoverableRows.length} recoverable failure URL(s) to re-queue.`);

const stmt = db.prepare(`
  UPDATE crawl_job_urls
  SET state = 'QUEUED', http_status = NULL, last_error = NULL
  WHERE job_id = ? AND url = ?
`);

const requeueMany = db.transaction(() => {
  for (const row of recoverableRows) {
    stmt.run(jobId, row.url);
  }
});

requeueMany();

console.log(`Successfully re-queued ${recoverableRows.length} recoverable URLs into 'QUEUED' state!`);
console.log('==========================================================================');
