-- SQLite schema for NECN NEXA (auto-applied by backend/db.js on startup)
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
