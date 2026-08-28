# Final Ollama removal and AI integration audit

## Scope

Read-only forensic audit of the current project, followed by an isolated local ONNX generation check. No application source, configuration, dependency, database, crawler, or model file was modified during this audit.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| A. Local LLM integrated | PASS | `backend/src/services/localLlm.ts` is the only runtime text-generation implementation. |
| B. Local embedding integrated | PASS | `semanticRag.ts` loads the bundled `embeddings` model with local-only Transformers settings. |
| C. Physical model files | PASS | LLM encoder/decoder, tokenizer/config files and MiniLM `model_quantized.onnx` are present beneath `models/`. |
| D. Actual local generation | PASS | Isolated ONNX test produced `Paris.` and reported `LOCAL_LLM_LOADED=true`. |
| E. Network-disabled generation | PASS | Test used `HF_HUB_OFFLINE=1`, empty `TRANSFORMERS_CACHE`/`XENOVA_CACHE`, and emitted `REMOTE_MODEL_DOWNLOAD=false`, `NETWORK_REQUIRED=false`. |
| F. Ollama runtime dependency | ABSENT | No Ollama package is declared in backend/root manifests or locks. |
| G. Ollama runtime calls | ABSENT | No `OLLAMA_HOST`, `localhost:11434`, `/api/generate`, `llama3.2`, or Ollama client remains in application runtime code. |
| H. Ollama package dependency | ABSENT | Manifest/lockfile audit found no Ollama package. |
| I. Gemini dependency | ABSENT | No `@google/genai` declaration remains in backend dependencies. |
| J. OpenAI dependency | ABSENT | No package or runtime import found. |
| K. Anthropic dependency | ABSENT | No package or runtime import found. |
| L. Remote model download | DISABLED | Both LocalLLM and embedding loader set `allowLocalModels=true` and `allowRemoteModels=false`. |
| M. Real NECN database retrieval | NOT RUN | Requires the remaining controlled database/chat validation. |
| N. Anti-hallucination | NOT RUN | Requires the remaining controlled endpoint validation. |
| O. Backend build | PASS | Previous production `npm run build` passed using `backend/scripts/build.cjs`. |
| P. TypeScript | PASS | Previous `npx tsc --noEmit` passed. |

## Runtime call graph

`frontend/src/components/ChatbotWidget.tsx` calls `POST /api/chat` → `backend/src/app.ts` → `findBestStrictAnswer` → website retrieval (`websiteSearch.ts` / `semanticRag.ts`) → `generateGroundedAnswer` → `localLlm.generate` → bundled `models/local-llm` LaMini-Flan-T5-77M ONNX.

There is no chatbot-to-Ollama or localhost:11434 runtime path.

## Non-runtime references

`ENV_EXAMPLE.txt` still contains obsolete Ollama variables (`LLM_PROVIDER`, `LLM_MODEL`, `OLLAMA_HOST`). This is documentation/config-template debt, not a runtime dependency or call. The audit did not alter it.

## Offline generation evidence

The isolated local generation process emitted:

```text
MODEL_SOURCE=LOCAL_PROJECT
LOCAL_LLM_LOADED=true
GENERATION_MODE=LOCAL_LLM
REMOTE_MODEL_DOWNLOAD=false
NETWORK_REQUIRED=false
```

The local model path was the project’s `models/local-llm` directory and the output was `Paris.`.

## Final verdict

```text
OLLAMA_REQUIRED=FALSE
LOCAL_LLM_PRODUCTION_PATH=PASS
AI_INTEGRATION_STATUS=FAIL
```

The overall status remains **FAIL** because real NECN database/chat retrieval and anti-hallucination endpoint tests have not yet been completed. The application must not be described as production-ready until those checks pass.
