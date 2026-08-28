# NECN Website Crawler — Admin Control Panel

The existing **Knowledge Base Engine** now contains the website crawler and synchronization controls. No separate crawler application is required.

## What it does

- Starts a background crawl from the Admin Control Panel.
- Restricts crawling to `https://necn.ac.in/` / `necn.ac.in`.
- Discovers URLs from XML sitemaps, `robots.txt`, the NECN human-readable site map, normal internal links, embedded document URLs, and older JavaScript navigation links.
- Processes HTML and text-based PDFs.
- Stores page content, source URL, category, content hash, ETag/Last-Modified and crawl timestamps in SQLite.
- Splits content into retrieval chunks and stores keyword metadata.
- Tracks every crawl as a `crawl_jobs` record.
- Shows live crawl progress, crawl history and the currently indexed NECN pages inside the admin UI.
- Supports automatic incremental synchronization. Unchanged pages are skipped through conditional requests/content hashes; changed pages are re-chunked.
- Keeps semantic embedding generation optional so the crawler itself does not require a paid API.

## Admin workflow

1. Start backend and frontend.
2. Open `http://localhost:5173/?admin=true`.
3. Select **Knowledge Base Engine**.
4. In **NECN Website Knowledge & Crawler**, keep:
   - Crawl limit: `0` (all discovered)
   - Automatic sync: enabled
   - Interval: `24` hours (or your preferred interval)
5. Click **Crawl NECN Now**.
6. Watch live discovered/crawled/updated/failed counts.
7. Use **Indexed NECN Pages** to verify the actual stored dataset.

## Important architecture decision

The crawler is institution-wide. It contains no Mechanical-HOD-specific logic. Mechanical HOD is only one possible validation question after the entire NECN dataset is indexed.

## Database tables

- `website_knowledge_settings` — crawl/scheduler configuration
- `website_pages` — canonical source pages/documents
- `website_chunks` — retrieval chunks and optional embeddings
- `crawl_jobs` — crawl history and progress

## API endpoints

- `POST /api/admin/website-sync` — start a background crawl
- `GET /api/admin/website-sync/status` — current crawl/database/RAG status
- `GET /api/admin/website-sync/jobs` — crawl history
- `GET /api/admin/website-sync/jobs/:id` — one crawl job
- `GET /api/admin/website-pages` — indexed page explorer/search
- `POST /api/admin/website-sync/embeddings` — optional semantic embedding backfill
- `GET/POST /api/admin/website-settings` — crawl/scheduler settings
