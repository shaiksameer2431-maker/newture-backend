# Final Post-Integration Production Validation

Date: 2026-08-18 (final live recheck)

## Final decision

`INTEGRATION_STATUS=BLOCKED`

The integrated production server and local LaMini model were verified, but the
required live crawl could not obtain any real NECN content from this execution
environment. The acceptance criteria explicitly prohibit treating startup as a
successful crawl.

## Validation evidence

| Check | Result |
| --- | --- |
| Backend production build | PASS — `backend/dist/server.cjs` produced |
| Backend TypeScript | PASS — `npx tsc --noEmit` |
| Production server startup | PASS — 110 routes, port 3000 |
| Canonical database open | PASS — `backend/data/necn.db` |
| SQLite integrity / FTS5 | PASS — integrity `ok`, FTS5 present |
| LaMini-Flan-T5-77M | PASS — `LOCAL_LLM_LOADED=true` |
| Remote model downloads | PASS — disabled |
| Real NECN crawl | BLOCKED |
| Real chat over crawled evidence | BLOCKED — corpus remained empty |
| Frontend/API regression | NOT ACCEPTED without corpus |

## Live crawl metrics

The real crawler was started at `https://necn.ac.in/`. It attempted sitemap
discovery, bootstrap discovery, browser transport, fetch, and curl retries.

```
DISCOVERED_URLS=1 (the start URL)
CRAWLED_URLS=0
SUCCESSFUL_PAGES=0
FAILED_PAGES=1
PDFS_DISCOVERED=0
PDFS_PROCESSED=0
CHUNKS_CREATED=0
EMBEDDINGS_CREATED=0
DATABASE_PAGES=0
DATABASE_CHUNKS=0
CRAWL_DURATION=93 seconds
```

## Blocker

**BLOCKER:** The runtime environment could not connect to `necn.ac.in:443`.
Crawler logs repeatedly reported `curl: (7) Failed to connect to necn.ac.in port
443` and `TypeError: fetch failed`. The optional Playwright transport also
reported that the `playwright` package is not installed.

**ROOT_CAUSE:** External network/site transport availability, not a content
cleaning or database error. No real document reached the ingestion pipeline.

DNS is healthy: `necn.ac.in` resolves to Cloudflare IPv4/IPv6 addresses. TCP 443
fails to both resolved IPv4 addresses (`TcpTestSucceeded=False`), and
`curl.exe -I` returns `curl: (7) Failed to connect to necn.ac.in port 443`.
The blocker is an outbound firewall/proxy/network restriction rather than DNS.

**FILE:** `backend/src/services/websiteCrawler.ts`.

**FUNCTION:** Browser/curl document acquisition and sitemap/bootstrap discovery.

**FIX:** No code change was made because substituting fixtures, static HTML, or
seed data would violate the validation instructions. The crawler correctly
recorded transport failures and retried.

**RETEST_RESULT:** BLOCKED in this environment. Re-run the same production build
and crawl from a network environment that can reach `https://necn.ac.in/`; then
run the 20-question chat, refusal, adversarial, restart, and original-feature
regression suites before changing the status to SUCCESS.

The obsolete cloud-AI stub identifiers were removed from runtime source and the
production bundle was rebuilt. Runtime search now finds no Ollama, Gemini,
OpenAI, Anthropic, `11434`, or remote-inference path.

## Model and prohibited-runtime audit

The production startup report showed local ONNX generation, and the runtime
reported `LOCAL_LLM_LOADED=true`, `REMOTE_MODEL_DOWNLOAD=false`, and
`NETWORK_REQUIRED=false` for inference. No Ollama runtime path is used by the
canonical backend. Full chat/RAG acceptance remains unverified because the
canonical database contains no crawled evidence.
