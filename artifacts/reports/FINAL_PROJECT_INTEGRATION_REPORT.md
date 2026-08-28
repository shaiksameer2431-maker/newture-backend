# NECN Final Project Integration Report

Date: 2026-08-18

## Result

`INTEGRATION_STATUS=BLOCKED`

The production structure and canonical paths are integrated, but the acceptance
status cannot be marked SUCCESS because the supplied source database currently
contains zero indexed website pages/chunks and the full live crawl, frontend
startup, and end-to-end AI regression suite were not executed in this session.

## Architecture

The original portal remains the application shell: frontend authentication,
navigation, chatbot, tickets, dashboards, notifications, and admin APIs are
preserved. The backend uses one persistent crawler and queue, one SQLite
repository, FTS5/BM25 plus local MiniLM semantic retrieval, grounded evidence
validation, and local LaMini-Flan-T5 generation with extractive refusal fallback.

## Completed integration work

- Created a source/database/configuration backup and [BACKUP_MANIFEST.md](BACKUP_MANIFEST.md).
- Added [FEATURE_REPLACEMENT_MATRIX.md](FEATURE_REPLACEMENT_MATRIX.md),
  [DATABASE_COMPARISON.md](DATABASE_COMPARISON.md), and
  [FINAL_DEPENDENCY_PLAN.md](FINAL_DEPENDENCY_PLAN.md).
- Established `backend/data/necn.db` as the canonical database without deleting
  the original database.
- Established `backend/models/Xenova/` as the canonical model directory and
  added SHA-256 records in `backend/models/MODEL_MANIFEST.md`.
- Made model/database paths independent of the production launch directory.
- Enforced local-only Transformers configuration (`allowLocalModels=true`,
  `allowRemoteModels=false`) and removed the deterministic hash embedding path.
- Removed the cloud AI environment variable from deployment configuration.
- Added an idempotent canonical database integrity/count/FTS migration verifier.

## Verification

| Check | Result |
| --- | --- |
| Backend TypeScript (`npx tsc --noEmit`) | PASS |
| Backend production bundle (`npm run build`) | PASS; `backend/dist/server.cjs` created |
| Canonical DB integrity | PASS (`ok`) |
| FTS5 presence | PASS |
| Local LaMini model files and SHA-256 | PASS |
| Local model policy | PASS |
| Frontend TypeScript/build command | No diagnostics observed |
| Live crawler and PDF crawl | NOT RUN |
| Full regression/evidence/grounding suite | NOT RUN |

## Known limitations / required acceptance steps

Run a real crawl from `https://necn.ac.in/`, backfill embeddings, exercise the
chat API and admin dashboard, then run the existing regression suites. Until
those steps populate and verify the knowledge corpus, the honest final status is
BLOCKED rather than SUCCESS.
