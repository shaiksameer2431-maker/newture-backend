const db = require('better-sqlite3')('data/database.db');
console.log(db.prepare("SELECT url, state, http_status FROM crawl_job_urls WHERE url LIKE '%Policy%'").all());
