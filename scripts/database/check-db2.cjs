const db = require('better-sqlite3')('data/database.db');
console.log('admission:', db.prepare("SELECT length(content) as len FROM website_pages WHERE url LIKE '%admission.php%'").get());
console.log('research:', db.prepare("SELECT length(content) as len FROM website_pages WHERE url LIKE '%Research-Policy%'").get());
console.log('placements:', db.prepare("SELECT length(content) as len FROM website_pages WHERE url LIKE '%placements.php%'").get());
console.log('facilities:', db.prepare("SELECT length(content) as len FROM website_pages WHERE url LIKE '%facilites.php%'").get());
