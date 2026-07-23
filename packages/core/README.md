# @useremember/core

Headless retrieval engine for [`remember`](../../README.md). It turns Markdown
into ranked, source-cited evidence for humans and agents. Provides:

- **CLI** (`remember init | dev | start | index | status`)
- **HTTP API** (Hono) — `/v1/search`, `/v1/pages`, `/v1/index`, `/v1/config`, `/v1/tools`, `/v1/events` (SSE), `/v1/openapi.json`
- **Indexer** — walks markdown, parses, chunks, embeds, stores
- **Pluggable adapters** — `Walker`, `Parser`, `Chunker`, `Embedder`, `Store`, `SearchEngine`, `Reranker`
- **Deterministic foundation** — model-backed planning and reranking are optional; search falls back to BM25 + vector + RRF

## Status

**v0.0.1 — working deterministic foundation.** Indexing, SQLite/sqlite-vec
storage, BM25 and vector retrieval, RRF fusion, path/heading signals,
page-level deduplication, HTTP routes, tool definitions, connectors, and the
viewer are implemented. The reranker is currently passthrough.

The competitive retrieval, evaluation, and future Answer direction is in
[`docs/retrieval-intelligence.md`](../../docs/retrieval-intelligence.md).

## Use as a library

```ts
import { defineConfig, defaults } from '@useremember/core';

export default defineConfig({
  content: './content',
  pipeline: {
    embedder: defaults.embedder.localOnnx(),
    chunker:  defaults.chunker.smartSplit({ size: 900, overlap: 0.15 }),
    store:    defaults.store.sqliteVec({ path: '.remember/index.db' }),
  },
});
```

See [the v1 design spec](../../docs/superpowers/specs/2026-05-23-remember-platform-design.md) for the full API surface.
