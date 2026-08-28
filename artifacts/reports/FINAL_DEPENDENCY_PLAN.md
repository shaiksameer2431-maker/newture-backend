# Final Dependency Plan

Keep the original backend dependency set: `better-sqlite3` for the single SQLite repository, `@xenova/transformers` for both local models, and the existing Express/TypeScript build tooling. Do not add Project B's `sql.js` or `pdf-parse`; they duplicate the production SQLite driver and PDF extractor. No cloud AI SDK is required by the canonical knowledge pipeline.
