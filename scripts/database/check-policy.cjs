const db = require('better-sqlite3')('data/database.db');
console.log(db.prepare("SELECT url FROM website_pages WHERE url LIKE '%Policy%'").all());
