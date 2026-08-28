# NEWTURE Backend

This repository contains the Express + TypeScript backend for the NEWTURE/Narayana NEXA project.

Quick start

```bash
cd backend
npm install
npm run build
npm start
```

Notes
- Environment variables (e.g., `GEMINI_API_KEY`) should be provided via a `.env` file or CI secrets.
- Database is SQLite; the DB file is kept out of Git via `.gitignore`.

To push this as a separate GitHub repo, provide the remote URL or allow me to create it using the `gh` CLI.

## Website Semantic RAG

The backend now supports semantic retrieval over the indexed NECN website. Set `GEMINI_API_KEY` in `.env`, run a website sync, then build the semantic index from the admin panel. Website chunks use Gemini retrieval embeddings and are stored locally in SQLite; the chatbot uses semantic + lexical retrieval and a grounded Gemini answer step. If Gemini is unavailable, keyword retrieval remains the safe fallback.

## Incremental synchronization

Website pages store content hashes plus ETag/Last-Modified validators. Unchanged pages are skipped and changed pages are re-chunked. The automatic scheduler runs according to `website_knowledge_settings.scheduled_interval_hours` when `is_scheduled_sync` is enabled.

## Fresh Windows setup

`npm run dev` automatically runs the backend setup/install lifecycle before starting `tsx watch server.ts`. You can therefore start from a fresh extraction with:

```bat
cd backend
npm run dev
```

## NECN Website Knowledge Crawler

The website knowledge sync is intentionally **crawl-first and API-free**. The official NECN site is the dataset.

The crawler now:

- starts from `https://necn.ac.in/`
- reads `robots.txt` sitemap declarations and common sitemap locations
- recursively reads sitemap indexes
- crawls same-domain HTML/XHTML pages
- follows normal links plus iframe/object/embed/source references and legacy inline navigation URLs
- indexes public `.pdf` documents as first-class knowledge pages
- preserves page/document URL, title, category, content hash and timestamps
- chunks changed content into the local SQLite knowledge base
- uses ETag/Last-Modified when available for incremental synchronization
- treats `crawl_limit = 0` as **all discoverable same-domain URLs**, with a 5,000 URL safety ceiling
- never scrapes the live website during a normal chat request

A successful first sync should show non-zero values for `pages_indexed`, `chunks_indexed`, and (for NECN's document-heavy site) `pdf_documents`.

For a fresh local setup:

```text
cd backend
npm install
npm run dev
```

In another terminal:

```text
cd frontend
npm install
npm run dev
```

Then open the admin dashboard and use **NECN Website Knowledge -> Sync Website Now**.

For the first sync, leave **Crawl limit = 0 (all discovered)**. The backend will log each URL as it is processed and will print a final discovered/crawled/updated/failed summary.
