# Feature Replacement Matrix

| Subsystem | Project A | Project B | Final decision |
| --- | --- | --- | --- |
| Portal, auth, tickets, admin, notifications | Complete | Not provided | KEEP_A |
| Persistent SQLite crawler | Complete: retries, cancellation, PDFs, queue state | Browser-only crawler | KEEP_A |
| Cleaning and chunking | Complete | Prototype | ADAPT_A_TO_B |
| Lexical retrieval | SQLite FTS5/BM25 | In-memory BM25 | KEEP_A |
| Semantic retrieval | Local MiniLM + SQLite vectors | Local MiniLM browser vectors | ADAPT_A_TO_B |
| Rerank/evidence/grounding | Complete server flow | Complete browser flow | KEEP_A |
| Local generation | LaMini ONNX weights present | Loader only; weights absent | ADAPT_A_TO_B |
| Database | Valid SQLite with application and crawl data | Incompatible with production driver | KEEP_A |
| Chat UI | Integrated portal widget | Standalone demo | KEEP_A |

The final system adopts the supplied engine's compatible design requirements—offline MiniLM/LaMini, hybrid retrieval, evidence gating, citations, and canonical paths—without retaining its browser-only implementation as a second production system.
