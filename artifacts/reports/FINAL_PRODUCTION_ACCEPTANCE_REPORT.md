# Final production acceptance report

## Verdict

```text
FINAL_PRODUCTION_STATUS=FAIL
```

The real `/api/chat` endpoint terminated the production backend during the first frontend-compatible request. No production-ready claim is warranted.

## Protected baseline

- Timestamped database and source archive: `backend/backups/acceptance-20260814-122*/`
- Database was not seeded, reset, migrated, replaced, or restored.
- Model SHA256 values were recorded before testing.

## Real database evidence

| Metric | Value |
| --- | ---: |
| Database | `backend/data/database.db` |
| Website pages | 837 |
| Active website pages | 834 |
| Website chunks | 841 |
| FTS5 rows (`chunks_fts`) | 834 |
| Stored embeddings | 3 |
| PDF-content pages | 11 |
| Queue state | 887 crawled, 1 crawling, 20 failed, 3,447 queued, 5 skipped |

The production SQLite database is the data source used by startup. The very low embedded-chunk count is an acceptance risk for semantic/hybrid retrieval.

## Production boot and local model

| Check | Result | Evidence |
| --- | --- | --- |
| LOCAL_LLM | PASS | Production `/api/health` loaded the bundled LaMini model. |
| LOCAL_EMBEDDINGS | PASS (physical/configuration) | Bundled MiniLM file exists and loader is local-only. End-to-end retrieval not reached. |
| OLLAMA_REMOVED | PASS | No runtime Ollama call/package found in the preceding audit. |
| REMOTE_MODEL_DOWNLOADS_DISABLED | PASS | Health returned `remoteModelDownload=false`; model settings show local=true, remote=false. |
| REAL_DATABASE | PASS | Health/startup used `backend/data/database.db`. |
| FTS5 | PASS | `chunks_fts` exists with 834 rows. |
| BACKEND_BUILD | PASS | Production build passed before this run. |
| TYPESCRIPT | PASS | `npx tsc --noEmit` passed before this run. |
| PRODUCTION_BOOT | PASS | Backend booted on port 3200 and recovered one stale crawl job. |

Health returned:

```text
modelSource=LOCAL_PROJECT
localLlmLoaded=true
generationMode=LOCAL_LLM
remoteModelDownload=false
networkRequired=false
```

## Real `/api/chat` failure

The actual production bundle was started and the frontend-compatible request below was sent to `POST /api/chat`:

```json
{"message":"What courses are available at NECN?","language":"en","chatHistory":[]}
```

The server logged the educational-query entry and local-model status, then closed the HTTP connection. It was no longer listening for subsequent requests. No JavaScript exception or `CHAT PIPELINE ERROR` was written to either captured log. Therefore no answer, source citations, retrieval candidates, grounding result, or generation latency can be honestly reported.

This blocked all required real-query, anti-hallucination, navigation-pollution, PDF-retrieval, and fallback endpoint checks.

## Crawler and scheduler evidence

- Persistent queue and stale-job recovery initialized.
- The scheduler automatically started an incremental synchronization run at normal backend startup.
- Browser-transport crawl attempts failed because the built backend could not import `playwright`.
- Whether native fetch is sufficient for every required crawler/PDF case remains unverified; `playwright` must be assessed before adding it as a dependency.

## Outstanding critical blockers

1. Diagnose the backend termination during the first real `/api/chat` request. Capture process exit code/peak RSS and determine whether model loading plus automatic crawling causes resource exhaustion or another native-runtime failure.
2. Restore successful browser-transport capability, or demonstrate with controlled tests that the existing native-fetch path fully preserves crawler and PDF requirements without Playwright.
3. Generate embeddings for the existing changed/unembedded chunks through the approved incremental pipeline; only 3 of 841 chunks are currently embedded.
4. Rerun the full real NECN endpoint suite, anti-hallucination suite, navigation-noise review, PDF checks, and fallback test only after the server remains alive.
5. Run dependency audit and every available automated test after endpoint stability is restored.

## Acceptance matrix

| Check | Status |
| --- | --- |
| HYBRID_RETRIEVAL | FAIL (not completed; endpoint terminated) |
| RERANKING | FAIL (not completed) |
| NAVIGATION_NOISE_SUPPRESSION | FAIL (not completed) |
| PDF_RETRIEVAL | FAIL (not completed) |
| REAL_CHAT_ENDPOINT | FAIL |
| GROUNDING | FAIL (not verified) |
| ANTI_HALLUCINATION | FAIL (not verified) |
| SOURCE_CITATIONS | FAIL (not verified) |
| EXTRACTIVE_FALLBACK | FAIL (not verified) |
| CRAWLER_REGRESSION | FAIL (browser transport unresolved) |
| SCHEDULER | PASS (initializes; content correctness remains pending) |
| PERSISTENT_QUEUE | PASS (state persisted and stale recovery ran) |
