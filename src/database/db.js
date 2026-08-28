import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
// The bundled CJS server runs from backend/dist; development commands run from
// backend. Neither path depends on a caller's arbitrary working directory.
const runtimeDirectory = typeof __dirname === 'string' ? __dirname : process.cwd();
const backendDirectory = path.basename(runtimeDirectory) === 'dist' ? path.resolve(runtimeDirectory, '..') : runtimeDirectory;
const bundledDatabasePath = path.join(backendDirectory, 'data', 'necn.db');
const DB_PATH = (() => {
  if (process.env.DATABASE_PATH) {
    return path.resolve(process.env.DATABASE_PATH);
  }
  // The checked-in canonical database is independent of the launch directory.
  // Deployments may override it with DATABASE_PATH (for example, a mounted disk).
  return bundledDatabasePath;
})();
const DB_DIR = path.dirname(DB_PATH);

let dbInstance = null;

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'Student',
  is_admin INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  keywords TEXT NOT NULL,
  synonyms TEXT,
  answer TEXT NOT NULL,
  related_department TEXT,
  related_questions TEXT,
  priority INTEGER DEFAULT 1,
  status TEXT DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_number TEXT,
  email TEXT,
  location TEXT,
  code TEXT,
  hod TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS faculty (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  designation TEXT,
  department TEXT,
  email TEXT,
  contact TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  student_name TEXT,
  email TEXT NOT NULL,
  country_code TEXT,
  phone TEXT,
  role TEXT,
  query TEXT NOT NULL,
  status TEXT DEFAULT 'Open',
  admin_response TEXT,
  responded_at TEXT,
  notification_channels TEXT,
  user_notified INTEGER DEFAULT 0,
  chat_session_id TEXT,
  conversation_id TEXT,
  language TEXT,
  user_id TEXT,
  current_page TEXT,
  website_section TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  type TEXT,
  image_url TEXT,
  is_pinned INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS portal_links (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  user_query TEXT NOT NULL,
  matched_rule_id TEXT,
  matched_question TEXT,
  score REAL DEFAULT 0,
  user_role TEXT,
  fallback_triggered INTEGER DEFAULT 0,
  user_id TEXT,
  FOREIGN KEY (matched_rule_id) REFERENCES rules(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS website_knowledge_settings (
  id TEXT PRIMARY KEY DEFAULT 'main',
  domain TEXT,
  crawl_url TEXT,
  crawl_limit INTEGER DEFAULT 0,
  scheduled_interval_hours INTEGER DEFAULT 24,
  is_scheduled_sync INTEGER DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS website_pages (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  category TEXT,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  http_status INTEGER,
  content_type TEXT,
  last_crawled TEXT NOT NULL DEFAULT (datetime('now')),
  last_changed TEXT,
  is_active INTEGER DEFAULT 1,
  etag TEXT,
  last_modified TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS website_chunks (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  heading TEXT,
  content TEXT NOT NULL,
  chunk_index INTEGER DEFAULT 0,
  keywords TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  embedding_json TEXT,
  embedding_model TEXT,
  embedding_dim INTEGER,
  embedded_at TEXT,
  FOREIGN KEY (page_id) REFERENCES website_pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS website_pdf_pages (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  text TEXT NOT NULL,
  extraction_method TEXT NOT NULL,
  text_length INTEGER NOT NULL,
  word_count INTEGER NOT NULL,
  ocr_used INTEGER DEFAULT 0,
  quality_score REAL NOT NULL,
  extraction_status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (page_id) REFERENCES website_pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crawl_jobs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  start_url TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'FULL',
  pages_discovered INTEGER DEFAULT 0,
  pages_crawled INTEGER DEFAULT 0,
  pages_updated INTEGER DEFAULT 0,
  pages_failed INTEGER DEFAULT 0,
  pages_new INTEGER DEFAULT 0,
  pages_unchanged INTEGER DEFAULT 0,
  pdf_documents INTEGER DEFAULT 0,
  chunks_created INTEGER DEFAULT 0,
  documents_skipped INTEGER DEFAULT 0,
  documents_too_large INTEGER DEFAULT 0,
  current_url TEXT,
  last_heartbeat_at TEXT,
  status TEXT DEFAULT 'running',
  error TEXT
);

CREATE TABLE IF NOT EXISTS crawl_errors (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  url TEXT NOT NULL,
  http_status INTEGER,
  error_message TEXT NOT NULL,
  stage TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES crawl_jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crawl_job_urls (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  url TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'QUEUED',
  retryable INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  mime_type TEXT,
  content_length INTEGER,
  last_error TEXT,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(job_id, url),
  FOREIGN KEY (job_id) REFERENCES crawl_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_website_pages_active ON website_pages(is_active);
CREATE INDEX IF NOT EXISTS idx_website_chunks_page ON website_chunks(page_id);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_started ON crawl_jobs(started_at);
CREATE INDEX IF NOT EXISTS idx_crawl_errors_url ON crawl_errors(url);
CREATE INDEX IF NOT EXISTS idx_crawl_job_urls_state ON crawl_job_urls(job_id, state);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY,
  full_name TEXT,
  role TEXT DEFAULT 'Student',
  is_admin INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS students (
  reg_no TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  branch TEXT NOT NULL,
  attendance REAL DEFAULT 0.0,
  cgpa REAL DEFAULT 0.0,
  mid1 INTEGER DEFAULT 0,
  mid2 INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info',
  is_read INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  notification_email TEXT,
  gmail_user TEXT,
  gmail_app_password TEXT,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_secure INTEGER DEFAULT 0,
  smtp_username TEXT,
  smtp_password TEXT,
  sender_name TEXT,
  email_from TEXT,
  notify_admin_on_ticket INTEGER NOT NULL DEFAULT 1,
  send_student_acknowledgement INTEGER NOT NULL DEFAULT 1,
  send_student_reply_notifications INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id TEXT,
  action TEXT NOT NULL,
  tables_affected TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_logs_timestamp ON chat_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_rules_category ON rules(category);
CREATE INDEX IF NOT EXISTS idx_rules_status ON rules(status);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_students_reg_no ON students(reg_no);
`;

function seedDefaultAdmin(db) {
  const existing = db.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').get();
  if (existing) return;

  const adminEmail = String(process.env.ADMIN_EMAIL || 'admin@necn.ac.in').trim().toLowerCase();
  const initialPassword = String(process.env.ADMIN_INITIAL_PASSWORD || 'ChangeMeNow123!');
  if (!/^\S+@\S+\.\S+$/.test(adminEmail) || initialPassword.length < 10) {
    console.warn('[DB] ⚠️ Invalid ADMIN_EMAIL or ADMIN_INITIAL_PASSWORD too short. Using default administrator setup.');
  }
  const adminId = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(initialPassword, 12);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, role, is_admin, created_at)
    VALUES (?, ?, ?, ?, 'ADMIN', 1, datetime('now'))
  `).run(adminId, adminEmail, passwordHash, 'NECN Chatbot Administrator');

  db.prepare(`
    INSERT INTO user_profiles (id, full_name, role, is_admin, created_at)
    VALUES (?, ?, 'ADMIN', 1, datetime('now'))
  `).run(adminId, 'NECN Chatbot Administrator');

  db.prepare(`
    INSERT OR IGNORE INTO website_knowledge_settings (id, domain, crawl_url, crawl_limit, scheduled_interval_hours, is_scheduled_sync, updated_at)
    VALUES ('main', 'necn.ac.in', 'https://necn.ac.in/', 0, 24, 1, datetime('now'))
  `).run();

  db.prepare(`
    UPDATE website_knowledge_settings
    SET domain = COALESCE(NULLIF(domain, ''), 'necn.ac.in'),
        crawl_url = 'https://necn.ac.in/',
        crawl_limit = CASE WHEN crawl_limit IS NULL OR crawl_limit = 250 OR crawl_limit < 0 THEN 0 ELSE crawl_limit END,
        scheduled_interval_hours = CASE WHEN scheduled_interval_hours IS NULL OR scheduled_interval_hours <= 0 THEN 24 ELSE scheduled_interval_hours END
    WHERE id = 'main'
  `).run();

  console.log(`[DB] Initial admin created for ${adminEmail}; remove ADMIN_INITIAL_PASSWORD after first login.`);
}

function ensureWebsiteSettings(db) {
  db.prepare(`
    INSERT OR IGNORE INTO website_knowledge_settings (id, domain, crawl_url, crawl_limit, scheduled_interval_hours, is_scheduled_sync, updated_at)
    VALUES ('main', 'necn.ac.in', 'https://necn.ac.in/', 0, 24, 1, datetime('now'))
  `).run();
  db.prepare(`
    UPDATE website_knowledge_settings
    SET domain = COALESCE(NULLIF(domain, ''), 'necn.ac.in'),
        crawl_url = 'https://necn.ac.in/',
        crawl_limit = CASE WHEN crawl_limit IS NULL OR crawl_limit = 250 OR crawl_limit < 0 THEN 0 ELSE crawl_limit END,
        scheduled_interval_hours = CASE WHEN scheduled_interval_hours IS NULL OR scheduled_interval_hours <= 0 THEN 24 ELSE scheduled_interval_hours END
    WHERE id = 'main'
  `).run();
}

function ensureWebsiteKnowledgeColumns(db) {
  const ensureColumns = (table, columns) => {
    const existing = db.prepare(`PRAGMA table_info('${table}')`).all().map(col => col.name);
    for (const [name, sql] of Object.entries(columns)) {
      if (!existing.includes(name)) {
        try { db.prepare(sql).run(); }
        catch (e) { console.warn(`[DB] Failed to add ${table}.${name}`, e); }
      }
    }
  };
  ensureColumns('website_pages', {
    etag: 'ALTER TABLE website_pages ADD COLUMN etag TEXT',
    last_modified: 'ALTER TABLE website_pages ADD COLUMN last_modified TEXT'
  });
  ensureColumns('crawl_jobs', {
    job_type: "ALTER TABLE crawl_jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'FULL'",
    pages_new: 'ALTER TABLE crawl_jobs ADD COLUMN pages_new INTEGER DEFAULT 0',
    pages_unchanged: 'ALTER TABLE crawl_jobs ADD COLUMN pages_unchanged INTEGER DEFAULT 0',
    pdf_documents: 'ALTER TABLE crawl_jobs ADD COLUMN pdf_documents INTEGER DEFAULT 0',
    chunks_created: 'ALTER TABLE crawl_jobs ADD COLUMN chunks_created INTEGER DEFAULT 0',
    documents_skipped: 'ALTER TABLE crawl_jobs ADD COLUMN documents_skipped INTEGER DEFAULT 0',
    documents_too_large: 'ALTER TABLE crawl_jobs ADD COLUMN documents_too_large INTEGER DEFAULT 0',
    current_url: 'ALTER TABLE crawl_jobs ADD COLUMN current_url TEXT'
    ,last_heartbeat_at: 'ALTER TABLE crawl_jobs ADD COLUMN last_heartbeat_at TEXT'
  });
  ensureColumns('website_chunks', {
    embedding_json: 'ALTER TABLE website_chunks ADD COLUMN embedding_json TEXT',
    embedding_model: 'ALTER TABLE website_chunks ADD COLUMN embedding_model TEXT',
    embedding_dim: 'ALTER TABLE website_chunks ADD COLUMN embedding_dim INTEGER',
    embedded_at: 'ALTER TABLE website_chunks ADD COLUMN embedded_at TEXT',
    section: 'ALTER TABLE website_chunks ADD COLUMN section TEXT',
    department: 'ALTER TABLE website_chunks ADD COLUMN department TEXT',
    start_offset: 'ALTER TABLE website_chunks ADD COLUMN start_offset INTEGER',
    end_offset: 'ALTER TABLE website_chunks ADD COLUMN end_offset INTEGER',
    chunk_hash: 'ALTER TABLE website_chunks ADD COLUMN chunk_hash TEXT'
  });
  ensureColumns('website_pages', {
    section: 'ALTER TABLE website_pages ADD COLUMN section TEXT',
    department: 'ALTER TABLE website_pages ADD COLUMN department TEXT',
    clean_title: 'ALTER TABLE website_pages ADD COLUMN clean_title TEXT',
    clean_content_hash: 'ALTER TABLE website_pages ADD COLUMN clean_content_hash TEXT'
  });
}

// FTS5 availability is probed once per process and cached. The chrome-aware
// search layer degrades to a LIKE-based lexical fallback when FTS5 is missing.
let fts5Probed = null;
export function fts5Available() {
  if (fts5Probed !== null) return fts5Probed;
  try {
    const db = getDb();
    const opts = db.prepare("PRAGMA compile_options").all().map(row => row.compile_options || '');
    const has = opts.some(o => /ENABLE_FTS5/i.test(o));
    fts5Probed = has;
    if (!has) console.warn('[DB] SQLite runtime was built without ENABLE_FTS5 — falling back to LIKE-based retrieval.');
  } catch (e) {
    fts5Probed = false;
    console.warn('[DB] Failed to probe FTS5 availability:', e instanceof Error ? e.message : e);
  }
  return fts5Probed;
}

export function ensureWebsiteKnowledgeFts(db) {
  if (!fts5Available()) return false;
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        chunk_id UNINDEXED,
        page_id UNINDEXED,
        title,
        section,
        department,
        url UNINDEXED,
        content,
        tokenize = 'porter unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER IF NOT EXISTS chunks_fts_ai AFTER INSERT ON website_chunks BEGIN
        INSERT INTO chunks_fts(chunk_id, page_id, title, section, department, url, content)
        VALUES (new.id, new.page_id,
          (SELECT COALESCE(clean_title, title, '') FROM website_pages WHERE id = new.page_id),
          COALESCE(new.section, ''),
          COALESCE(new.department, ''),
          (SELECT url FROM website_pages WHERE id = new.page_id),
          new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_fts_au AFTER UPDATE ON website_chunks BEGIN
        DELETE FROM chunks_fts WHERE chunk_id = old.id;
        INSERT INTO chunks_fts(chunk_id, page_id, title, section, department, url, content)
        VALUES (new.id, new.page_id,
          (SELECT COALESCE(clean_title, title, '') FROM website_pages WHERE id = new.page_id),
          COALESCE(new.section, ''),
          COALESCE(new.department, ''),
          (SELECT url FROM website_pages WHERE id = new.page_id),
          new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_fts_ad AFTER DELETE ON website_chunks BEGIN
        DELETE FROM chunks_fts WHERE chunk_id = old.id;
      END;
    `);
    return true;
  } catch (e) {
    console.warn('[DB] Failed to create chunks_fts virtual table or triggers:', e instanceof Error ? e.message : e);
    return false;
  }
}

// The FTS table is external-content-like (it is maintained by our triggers),
// so older databases created before those triggers need one safe backfill.
// Rebuilding only when counts differ makes this idempotent and avoids a second
// index or a snapshot database.
export function rebuildWebsiteKnowledgeFts(db) {
  if (!fts5Available()) return { available: false, rebuilt: false, count: 0 };
  try {
    const expected = Number(db.prepare(`SELECT count(*) AS n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1 AND trim(c.content)<>''`).get().n || 0);
    const actual = Number(db.prepare('SELECT count(*) AS n FROM chunks_fts').get().n || 0);
    if (actual === expected) return { available: true, rebuilt: false, count: actual };
    const rebuild = db.transaction(() => {
      db.prepare('DELETE FROM chunks_fts').run();
      db.prepare(`INSERT INTO chunks_fts(chunk_id,page_id,title,section,department,url,content)
        SELECT c.id,c.page_id,COALESCE(p.clean_title,p.title,''),COALESCE(c.section,''),COALESCE(c.department,''),p.url,c.content
        FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1 AND trim(c.content)<>''`).run();
    });
    rebuild();
    console.log(`[DB] Rebuilt FTS5 index with ${expected} active crawler chunks.`);
    return { available: true, rebuilt: true, count: expected };
  } catch (error) {
    console.warn('[DB] Failed to rebuild FTS5 index:', error instanceof Error ? error.message : error);
    return { available: true, rebuilt: false, count: 0 };
  }
}

function ensureAppSettingsColumns(db) {
  const existingColumns = db.prepare("PRAGMA table_info('app_settings')").all().map(col => col.name);
  const addIfMissing = (col, sql) => { if (!existingColumns.includes(col)) { try { db.prepare(sql).run(); } catch (e) { console.warn('[DB] Failed to add column', col, e); } } };
  addIfMissing('gmail_user', "ALTER TABLE app_settings ADD COLUMN gmail_user TEXT");
  addIfMissing('gmail_app_password', "ALTER TABLE app_settings ADD COLUMN gmail_app_password TEXT");
  addIfMissing('smtp_host', "ALTER TABLE app_settings ADD COLUMN smtp_host TEXT");
  addIfMissing('smtp_port', "ALTER TABLE app_settings ADD COLUMN smtp_port INTEGER");
  addIfMissing('smtp_secure', "ALTER TABLE app_settings ADD COLUMN smtp_secure INTEGER DEFAULT 0");
  addIfMissing('smtp_username', "ALTER TABLE app_settings ADD COLUMN smtp_username TEXT");
  addIfMissing('smtp_password', "ALTER TABLE app_settings ADD COLUMN smtp_password TEXT");
  addIfMissing('sender_name', "ALTER TABLE app_settings ADD COLUMN sender_name TEXT");
  addIfMissing('email_from', "ALTER TABLE app_settings ADD COLUMN email_from TEXT");
}

export function getDb() {
  if (dbInstance) return dbInstance;

  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }

    if (!fs.existsSync(DB_PATH) && fs.existsSync(bundledDatabasePath) && DB_PATH !== bundledDatabasePath) {
      console.log(`[DB] Seeding new database at ${DB_PATH} from bundled database ${bundledDatabasePath}...`);
      try {
        fs.copyFileSync(bundledDatabasePath, DB_PATH);
        console.log(`[DB] Successfully seeded initial database to ${DB_PATH}`);
      } catch (copyErr) {
        console.warn(`[DB] Could not copy bundled database:`, copyErr);
      }
    }

    dbInstance = new Database(DB_PATH);
  } catch (err) {
    console.error('[DB] Failed to open database at', DB_PATH, ' - falling back to in-memory DB. Error:', err);
    try {
      dbInstance = new Database(':memory:');
    } catch (innerErr) {
      console.error('[DB] Failed to create in-memory SQLite DB:', innerErr);
      throw innerErr;
    }
  }

  try {
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
    dbInstance.exec(SCHEMA);
    ensureAppSettingsColumns(dbInstance);
    ensureWebsiteKnowledgeColumns(dbInstance);
    ensureWebsiteKnowledgeFts(dbInstance);
    rebuildWebsiteKnowledgeFts(dbInstance);
    ensureWebsiteSettings(dbInstance);
    seedDefaultAdmin(dbInstance);
  } catch (migrationErr) {
    console.error('[DB] Error while applying schema or seeding data:', migrationErr);
  }

  return dbInstance;
}

export function getDbPath() {
  return DB_PATH;
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
