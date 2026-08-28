# Production Network Reliability Report

## Root cause

DNS resolves NECN correctly, but this runtime cannot establish outbound TCP/443.
The application is not hiding that failure and no fixtures or synthetic content
are used.

## Targeted changes

- Added `GET /health/database` for canonical SQLite validation.
- Added `GET /health/external-sources`, which reports DNS, TCP/TLS inference,
  and HTTP status without exposing addresses or credentials. External failure
  returns `200` with `status: degraded`; the application remains healthy.
- Made crawler retry count and exponential backoff configurable through
  `HTTP_MAX_RETRIES` and `HTTP_RETRY_BACKOFF`.
- Documented `HTTP_TOTAL_TIMEOUT`, `HTTP_CONNECT_TIMEOUT`,
  `HTTP_READ_TIMEOUT`, `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`, and
  `NECN_CRAWL_URL` in `ENV_EXAMPLE.txt`. The existing curl transport honors
  standard proxy environment variables and keeps TLS verification enabled.

## Verification

- `npx tsc --noEmit`: PASS.
- `npm run build`: PASS.
- Production server on port 3010: PASS; 112 routes loaded.
- `/health/database`: PASS; canonical `backend/data/necn.db` opened.
- `/health/external-sources`: PASS as a diagnostic; returned `status=degraded`,
  `dns=ok`, `tcp=failed`, `http=failed`, `TypeError: fetch failed`.
- Direct curl/TCP test: FAIL with `curl: (7) Failed to connect ... port 443`.

## Deployment requirement

The production host must permit outbound HTTPS to `necn.ac.in`, or provide an
HTTPS proxy via `HTTPS_PROXY`/`HTTP_PROXY` with `NO_PROXY` configured for local
services. No application code can override a hosting firewall or egress policy.

`INTEGRATION_STATUS=BLOCKED` remains correct until a deployed runtime can fetch
real NECN content and complete ingestion, retrieval, citation, and regression
tests.

## Final runtime validation (2026-08-18)

The host temporarily reported DNS success, TCP 443 success, and an HTTP 200 from
PowerShell `curl.exe`. However, the actual production Node runtime then failed
both `fetch` and its child `curl.exe` transport. The crawler completed its real
job with `pages_discovered=1`, `pages_crawled=0`, `pages_failed=1`, and error
`no response from Node fetch or curl transport`. The canonical database remained
at zero indexed pages/chunks/embeddings. This is not an ingestion success; the
runtime/network path is intermittent or differs between the interactive shell
and the Node process, so the status remains BLOCKED.
