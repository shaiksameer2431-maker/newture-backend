const db = require('better-sqlite3')('data/database.db');
const chunks = db.prepare("SELECT length(content) as len, id, heading FROM website_chunks WHERE page_id IN (SELECT id FROM website_pages WHERE url LIKE '%placements.php%')").all();
console.log(chunks);
