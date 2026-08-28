# Local AI integration report

## Status

**Not production ready.** The backend production build and local model health check now pass, but crawler browser transport is blocked by a missing `playwright` runtime dependency and the remaining end-to-end validation is incomplete.

## Baseline protection

- Database backup verified: `backend/backups/integration-20260814-120619/database.db`
- Source backup: `backend/backups/integration-20260814-120619/source-tree-files-verified.zip`
- Package manifests and live SQLite schema snapshot: `backend/backups/integration-20260814-120619/baseline/`
- No crawler data was replaced or migrated.

## AI audit and changes

- Replaced the reachable Ollama `/api/generate` call in `backend/src/services/semanticRag.ts` with the bundled local ONNX generator.
- Added `backend/src/services/localLlm.ts`, which verifies local model files and configures Transformers with `allowLocalModels=true` and `allowRemoteModels=false`.
- Updated MiniLM embedding loading to disable remote models and use the bundled `models/embeddings` directory.
- Removed `@google/genai` from `backend/package.json` and lockfile through `npm install`.
- Preserved the crawler, queue, SQLite tables, FTS5 retrieval, scheduler, PDF handling, frontend, authentication, and chat endpoint response fields.

## Bundled model SHA256

| File | SHA256 |
| --- | --- |
| `models/local-llm/onnx/decoder_model_merged_quantized.onnx` | `E2CC3C6A18BA1952567754366C7A76C0F266AFC5D071B5488138B7F684D63C28` |
| `models/local-llm/onnx/encoder_model_quantized.onnx` | `4F390DE450B7D6F23817795484E37CCB0F6C2BBE618F4BAD414712C664CFE07D` |
| `models/embeddings/onnx/model_quantized.onnx` | `E34997D28F61C7565D773C3462C3E6224FB9757300086A88A88468DE3D7EC4E8` |

## Validation performed

- `npm install --no-audit --no-fund` (backend): passed; removed 24 obsolete packages.
- `npm run typecheck` (backend): passed.
- Backend build root cause: the Windows esbuild wrapper stripped the leading `./` from relative `server.ts` entry paths and the sandbox denied its parent-directory resolution. `backend/server.ts` was present throughout.
- Exact build fix: added `backend/scripts/build.cjs`, a portable esbuild API launcher with an absolute entry point, and changed the backend build script to invoke it. `npm run build` and `npx tsc --noEmit` now pass.
- Production health check: passed against `backend/data/database.db`. It loaded `models/local-llm` and returned `modelSource=LOCAL_PROJECT`, `localLlmLoaded=true`, `generationMode=LOCAL_LLM`, `remoteModelDownload=false`, and `networkRequired=false`.
- `npm test` (backend): blocked; no `test` script exists.
- Crawler startup regression: scheduler and persistent queue started and database path remained the production SQLite database, but browser-transport crawl attempts failed because `playwright` is not installed or declared in the backend runtime dependencies.
- Frontend build, offline actual-generation test, real NECN queries, anti-hallucination tests, and performance measurements remain pending.

## Remaining blockers

1. Restore the crawler's required `playwright` runtime dependency through the project's approved dependency workflow, then rerun controlled crawler/PDF regression checks.
2. Add or identify the project’s intended `npm test` suite.
3. Run the final application offline and execute the required real NECN queries, anti-hallucination cases, frontend checks, and performance measurements.
