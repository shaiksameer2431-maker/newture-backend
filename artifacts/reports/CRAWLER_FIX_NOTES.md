# NECN Crawler Fix — Transport Layer

The previous crawler stopped at `https://necn.ac.in/` because Node's built-in `fetch()` could receive an HTTP 500 while Windows `curl -I https://necn.ac.in` succeeds.

This build adds a two-transport fetcher:

1. Node `fetch()` with browser-like headers.
2. Automatic `curl.exe` fallback on Windows (or `curl` on Linux/macOS) when Node fetch throws or receives HTTP 4xx/5xx.

The crawler still:
- restricts crawling to `necn.ac.in`
- discovers XML sitemaps, robots.txt sitemap entries, and NECN human-readable site-map pages
- follows internal HTML links and embedded document links
- indexes HTML and PDF text
- stores pages/chunks in SQLite
- records incremental content hashes and ETag/Last-Modified
- records per-page failure diagnostics in crawl history

## Run

Backend:
```text
cd backend
npm install
npm run dev
```

Frontend:
```text
cd frontend
npm install
npm run dev
```

Open:
```text
http://localhost:5173/?admin=true
```

Then:
Knowledge Base Engine -> Crawl NECN Now

Leave Crawl limit at `0` for all discovered URLs.

## What success should look like

Backend should show lines similar to:
```text
[CRAWLER] Native fetch returned 500 for https://necn.ac.in/; trying curl fallback.
[CRAWLER] 200 https://necn.ac.in/
[CRAWLER] Human-readable site map discovery found ...
[CRAWLER] Sitemap discovery found ... official URLs.
[CRAWLER] Bootstrap discovery returned ... official URLs.
[CRAWLER] 200 https://necn.ac.in/...
[WEBSITE SYNC] Completed: discovered=..., crawled=..., updated=..., failed=0.
```

The exact counts depend on what NECN publishes and what is publicly reachable at crawl time.
