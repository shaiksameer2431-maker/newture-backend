# Full Crawl Reliability and Production Acceptance

## Result

`INTEGRATION_STATUS=BLOCKED`

The real NECN source was reachable and bounded production crawls completed. The unrestricted crawl did not reach a terminal completed state within the validation window. It progressed to 296 crawled / 171 failed of 1,220 discovered, then remained processing a real PDF (`NECR-B.TECH-R21-REGULATIONS-NECG-3-3-23-A5.pdf`). The job was stopped for safety, so the 1,220-URL terminal-state requirement is not claimed.

## Confirmed fix and evidence

- The blocking `acd coun_merged.pdf` path was traced to the synchronous legacy PDF fallback, which could monopolize the event loop after worker extraction returned garbled text.
- Large-PDF synchronous fallback is now disabled by default (`PDF_SYNC_FALLBACK_MAX_BYTES=0`); it returns a terminal extraction failure instead of blocking.
- PDF extraction has a bounded 10-second default (`PDF_EXTRACTION_TIMEOUT_MS`, configurable).
- HTML/PDF downloads are size bounded; URL state is explicitly set to `FAILED`/`SKIPPED` on all extraction and unsupported-content exits; worker accounting is protected by `finally`.
- TypeScript validation and production frontend/backend builds passed.

## Real crawl results

- 100-page crawl: completed; 100 crawled, 7 failed, 33 new, 54 chunks created. The known malformed/short HTML pages and `acd coun_merged.pdf` were terminal failures.
- Final unrestricted crawl (`maxPages=0`, job `40cf900e-cced-49d7-aeba-5d91f1859f5b`) reached complete discovery of 1,220 and continued progressing under the 10-second timeout. End-of-window accounting: `CRAWLED=123`, `FAILED=173`, `SKIPPED=1`, `CRAWLING=1`, `QUEUED=922` (total 1,220). Current URL was `https://necn.ac.in/pdf/M.Tech-R25-REGULATIONS.pdf`. It did not reach `remaining=0` during this acceptance window, so full acceptance is not claimed.

## Remaining blocker

The live NECN site exposes a large number of PDFs whose extraction can each consume the configured timeout. The queue is progressing and failures are isolated, but a complete 1,220-URL run was not completed in this acceptance window. A subsequent run with the 10-second timeout should be used for final completion verification.
