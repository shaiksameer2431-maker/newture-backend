# Database Consolidation

Canonical production database: `backend/data/necn.db`.

The original valid database contains application tables (users, rules, tickets, notifications, student and admin state) plus website pages/chunks, crawl jobs, queue state, embeddings, and `chunks_fts` with maintenance triggers. The supplied engine's `data/necn-production.db` is a browser SQL.js artifact that the production `better-sqlite3` driver rejects as `unsupported file format`; it is not a migration source.

`npm run migrate:canonical-db --prefix backend` verifies the canonical copy using SQLite integrity check, required row counts, and FTS presence. IDs, timestamps, and relationships are preserved because the source database is copied intact.
