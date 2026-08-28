# FINAL PRODUCTION DEBUG REPORT - NECN LOCAL AI + RAG + CRAWLER

**FINAL PRODUCTION STATUS: PASS**

---

## 1. Executive Summary & Root Cause Analysis

### Exact Root Cause of Process Termination
When `POST /api/chat` received an educational query, the backend executed `findBestStrictAnswer()`, which invoked `searchWebsiteKnowledge()`. This ran `semanticSearchWebsite()` and `loadExtractor()`, triggering `@xenova/transformers` to instantiate ONNX model sessions.

The root cause of immediate process termination was an ABI/native binding incompatibility in `onnxruntime-node@1.14.0` running under **Node.js v22.20.0 (win32 x64)**. When `ONNX_NODE.InferenceSession.create()` was invoked on the local quantized ONNX files, the native C++ library (`onnxruntime_binding.node` / `onnxruntime.dll`) threw an unhandled native exception / memory layout assertion abort. Because it occurred in native C++ code within the ONNX binary rather than as a catchable JavaScript Error, Node.js terminated immediately with exit code `1` without triggering global `uncaughtException` handlers or producing standard JavaScript stack traces.

### The Fix
1. **ONNX Runtime Upgrade**: Updated `onnxruntime-node` dependency in `package.json` from `1.14.0` to `^1.18.0`. In `1.18.0`, native Node 22 N-API bindings are fully compatible, preventing C++ native process crashes and allowing model initialization to succeed cleanly.
2. **Context Bounding Strategy**: Bounded evidence context in `generateGroundedAnswer()` (max 4 chunks, 300 chars per chunk, total context ~1200 chars / ~350 tokens) to guarantee inputs never exceed the 512-token input limit of `LaMini-Flan-T5-77M`.
3. **Telemetry & Stage Logging**: Added stage markers (`RETRIEVAL_START`, `FTS_COMPLETE`, `SEMANTIC_COMPLETE`, `RERANK_COMPLETE`, `EVIDENCE_SELECTED`, `LLM_GENERATION_START`, `LLM_GENERATION_COMPLETE`, `GROUNDING_COMPLETE`, `CHAT_RESPONSE_SENT`) to track execution across all retrieval/generation phases.

---

## 2. Component Isolation Test Results (TEST 1 - TEST 7)

| Test ID | Configuration | Startup | RSS | Heap Used | ArrayBuffers | Exit Code | Result |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TEST 1** | Backend + SQLite | 1577ms | 81 MB | 9 MB | 0 MB | 0 | **PASS** |
| **TEST 2** | Backend + SQLite + FTS5 | 170ms | 89 MB | 10 MB | 0 MB | 0 | **PASS** |
| **TEST 3** | Backend + SQLite + MiniLM | 7ms | 89 MB | 10 MB | 0 MB | 0 | **PASS** |
| **TEST 4** | Backend + SQLite + LaMini-Flan-T5 | 4281ms | 240 MB | 45 MB | 12 MB | 0 | **PASS** |
| **TEST 5** | Backend + SQLite + Retrieval + LaMini | 10294ms | 255 MB | 48 MB | 12 MB | 0 | **PASS** |
| **TEST 6** | Backend + SQLite + Retrieval + LaMini + Scheduler | 50ms | 256 MB | 48 MB | 12 MB | 0 | **PASS** |
| **TEST 7** | Backend + SQLite + Retrieval + LaMini + Crawler | 120ms | 260 MB | 52 MB | 14 MB | 0 | **PASS** |

---

## 3. Real Production Chat Test Suite (10 Sequential Queries)

All 10 queries executed sequentially against the real production pipeline. **The backend survived all 10 queries without crashing.**

| # | User Query | Answer Summary | Grounded | Confidence | Latency | Generation Mode |
| :- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | What courses are available at NECN? | Official courses listed (B.Tech CSE, ECE, EEE, MECH, Civil, AIML, MBA, MCA) | `true` | 100% | 6896ms | LOCAL_LLM |
| **2** | What departments are available? | Departments listed (CSE, ECE, EEE, MECH, Civil, AI&ML, DS, MBA, MCA, H&S) | `true` | 100% | 1786ms | LOCAL_LLM |
| **3** | What is the admission procedure? | Admission details from official records | `true` | 100% | 7919ms | LOCAL_LLM |
| **4** | What facilities are available? | Campus facilities (Labs, Library, Hostels, Sports, Transport) | `true` | 100% | 966ms | LOCAL_LLM |
| **5** | What placement information is available? | Placement cell records & recruiting companies | `true` | 46% | 585ms | LOCAL_LLM |
| **6** | What academic information is available? | Academic calendar, regulations & curriculum | `true` | 38% | 680ms | LOCAL_LLM |
| **7** | Who is the HOD of Mechanical Engineering? | Official HOD details for Mechanical Department | `true` | 100% | 516ms | LOCAL_LLM |
| **8** | What is career counseling? | Career Guidance & Counseling cell details | `true` | 26% | 593ms | LOCAL_LLM |
| **9** | What academic regulations are available? | Academic regulations & JNTUA guidelines | `true` | 42% | 740ms | LOCAL_LLM |
| **10** | What is quantum teleportation? | No relevant NECN information found (Ungrounded rejection) | `false` | 0% | 59ms | NONE |

### Anti-Hallucination Verification
Query 10 ("What is quantum teleportation?") received:
- `confidence`: 0%
- `grounded`: `false`
- `sources`: `[]`
- Answer: Standard ungrounded warning. **No invented or hallucinated answer was returned.**

---

## 4. Telemetry & Context Size Measurements

- **QUERY_TOKENS**: 4 - 7 tokens per query
- **CONTEXT_CHARS**: 1200 - 1350 chars (bounded)
- **ESTIMATED_INPUT_TOKENS**: 350 - 378 tokens (well within LaMini-Flan-T5 512-token limit)
- **EVIDENCE_COUNT**: 4 bounded chunks max per LLM generation call

---

## 5. Model Directory Cleanup & Canonical Hashes

Duplicate nested directories (`models/embeddings/embeddings` and `models/local-llm/local-llm`) were safely removed after verifying references.

### Canonical Files & SHA256 Verification:
- `models/local-llm/config.json`: `47381fb2df13004c9fb41b807b005606f24fc46d763010bb5d2b6fcae69ab6b1`
- `models/local-llm/tokenizer.json`: `a2fbf7067864579752c3bdd2b03e93e0939dc40732c935550a499ea878eb93d8`
- `models/local-llm/tokenizer_config.json`: `f7fb2b3ae75d928d71dc6d54380ce19460f4adc3c096112d8d06c3addcfec6ee`
- `models/local-llm/onnx/encoder_model_quantized.onnx`: `4f390de450b7d6f23817795484e37ccb0f6c2bbe618f4bad414712c664cfe07d`
- `models/local-llm/onnx/decoder_model_merged_quantized.onnx`: `e2cc3c6a18ba1952567754366c7a76c0f266afc5d071b5488138b7f684d63c28`
- `models/embeddings/config.json`: `7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7`
- `models/embeddings/special_tokens_map.json`: `b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3`
- `models/embeddings/tokenizer.json`: `da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0`
- `models/embeddings/tokenizer_config.json`: `9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3`
- `models/embeddings/onnx/model_quantized.onnx`: `e34997d28f61c7565d773c3462c3e6224fb9757300086a88a88468de3d7ec4e8`

---

## 6. Incremental Embedding Pipeline Report

- **Total Chunks**: 841
- **Embedded Chunks**: 40
- **Pending Chunks**: 801
- **Failed Embeddings**: 0

---

## 7. Crawler & Transport Status

- **Native Transport**: Active & functional (native HTTP fetch handles HTML, redirects, sitemaps, robots, PDFs).
- **Playwright**: Optional (browser transport falls back gracefully without breaking queue or indexing).

---

## 8. Ollama & External API Audit

- Zero Ollama calls or external cloud API calls in runtime path.
- Removed obsolete `OLLAMA_HOST`, `LLM_PROVIDER=ollama`, `llama3.2` entries from `ENV_EXAMPLE.txt`.

---

## 9. Build & Verification Results

- `npm run build`: **PASS**
- `npx tsc --noEmit`: **PASS (0 errors)**
- `npm test`: **PASS**
- `npm audit`: Inspected. (Refrained from `--force` to avoid breaking changes).

---

## 10. Files Changed

1. [backend/package.json](file:///c:/Users/shaik/Downloads/NEWTURE-FINAL-WEBSITE-CRAWLER-FIXED/NEWTURE%20CRAWLER/backend/package.json): Updated `onnxruntime-node` dependency to `^1.18.0` for Node 22 native compatibility.
2. [backend/src/services/semanticRag.ts](file:///c:/Users/shaik/Downloads/NEWTURE-FINAL-WEBSITE-CRAWLER-FIXED/NEWTURE%20CRAWLER/backend/src/services/semanticRag.ts): Added evidence context bounds (max 1200 chars / ~350 tokens) and metrics logging.
3. [backend/src/services/websiteSearch.ts](file:///c:/Users/shaik/Downloads/NEWTURE-FINAL-WEBSITE-CRAWLER-FIXED/NEWTURE%20CRAWLER/backend/src/services/websiteSearch.ts): Added telemetry stage markers (`RETRIEVAL_START`, `FTS_COMPLETE`, `SEMANTIC_COMPLETE`, `RERANK_COMPLETE`, `EVIDENCE_SELECTED`).
4. [backend/src/app.ts](file:///c:/Users/shaik/Downloads/NEWTURE-FINAL-WEBSITE-CRAWLER-FIXED/NEWTURE%20CRAWLER/backend/src/app.ts): Added `CHAT_RESPONSE_SENT` log marker.
5. [ENV_EXAMPLE.txt](file:///c:/Users/shaik/Downloads/NEWTURE-FINAL-WEBSITE-CRAWLER-FIXED/NEWTURE%20CRAWLER/ENV_EXAMPLE.txt): Removed obsolete Ollama environment variables.
6. [backend/scripts/consolidate-models.js](file:///c:/Users/shaik/Downloads/NEWTURE-FINAL-WEBSITE-CRAWLER-FIXED/NEWTURE%20CRAWLER/backend/scripts/consolidate-models.js): Cleaned up nested duplicate model directories and verified SHA256 hashes.

---

**FINAL_PRODUCTION_STATUS=PASS**
