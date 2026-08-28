# Node Runtime Network Diagnostic

## Root cause

The earlier mismatch was caused by the Codex sandbox policy, not the
application's HTTP implementation. Inside the sandbox, the process identity was
`u\\codexsandboxoffline`; repeated Node `fetch` and native `https` calls failed
with underlying `EACCES`, and Node-spawned `curl.exe` also failed with `EACCES`.
The same Node executable (`v22.20.0`) run outside the sandbox succeeded with
HTTP 200. DNS was intermittent inside the sandbox (`ETIMEOUT`/`ENOTFOUND`).

## Outside-sandbox production evidence

- `/health/external-sources`: `dns=ok`, `tcp=ok`, `tls=ok`, `http=ok`.
- Real sitemap discovery: 135 official URLs; recursive discovery reached 1,029.
- Real fetches returned HTTP 200 for NECN pages and PDFs.
- A bounded real crawl (`maxPages=10`) completed: 10 discovered, 10 crawled,
  2 extraction failures, 8 active pages persisted, 90 total chunks present.
- 12 active chunks received local MiniLM embeddings successfully.
- Real `/api/chat` returned grounded answers with official NECN citations.
- After restart, FTS5 rebuilt and the same real chat query remained answerable.

## Remaining blocker

The unrestricted full crawl (`maxPages=0`) discovered 1,029 URLs but stopped
responding after 64 pages/3 failures; its job remained running until stale-job
recovery marked it interrupted. This prevents claiming complete full-site
acceptance. The bounded crawl proves transport, extraction, persistence,
embedding, retrieval, citation, restart, and recovery paths, but not full crawl
completion.

`INTEGRATION_STATUS=BLOCKED`
