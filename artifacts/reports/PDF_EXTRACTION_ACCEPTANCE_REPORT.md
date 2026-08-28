# PDF Extraction Acceptance

## Methods available

- `worker_primary`: bounded worker-thread extraction.
- `sync_secondary`: legacy parser is retained only behind `PDF_SYNC_FALLBACK_MAX_BYTES`; default remains `0`, so large/expensive PDFs never execute it on the main thread.
- No OCR dependency exists in the project; no OCR dependency was added.

The extractor now validates minimum length, printable ratio, whitespace ratio, repeated-character garbage, and parser corruption. It returns explicit terminal reasons (`PDF_EXTRACTION_TIMEOUT`, `PDF_EMPTY_TEXT`, `PDF_CORRUPTED`, `PDF_UNSUPPORTED`) and reports method, duration, and text length.

## Real NECN PDF checks

| URL | Size | Method | Duration | Result |
|---|---:|---|---:|---|
| `acd coun_merged.pdf` | 386,440 bytes | none | 74 ms | `PDF_EMPTY_TEXT` |
| `NECR-B.TECH-R21-REGULATIONS-NECG-3-3-23-A5.pdf` | 1,653,975 bytes | none | 91 ms | `PDF_EMPTY_TEXT` |
| `M.Tech-R25-REGULATIONS.pdf` | fetch did not complete in the bounded network test | — | — | network acquisition blocker |

## Validation

- TypeScript: PASS.
- Production backend/frontend build: PASS.
- Real bounded crawl (`maxPages=100`): started, but did not complete in the validation window; it remained at 1 crawled, 1 in progress, 98 queued while processing `site-map.php`.
- No PDF was marked successful without meaningful text.
- Existing persistence, chunking, embeddings, retrieval and chat code was not redesigned.

## Status

`INTEGRATION_STATUS=BLOCKED`

The PDF pipeline changes are implemented, but the required 100-page acceptance crawl did not reach a terminal state because the live run remained in progress on `site-map.php`; therefore no success claim is made.
