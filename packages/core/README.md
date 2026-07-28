# @useremember/core

Headless retrieval engine for [`remember`](../../README.md). It turns Markdown
into ranked, source-cited evidence for humans and agents. Provides:

- **CLI** (`remember init | dev | start | index | search | list | get | status | tools`) — formatted result cards and aligned dashboards for humans, stable `--json` on every read command for agents
- **HTTP API** (Hono) — `/v1/search`, `/v1/pages`, `/v1/index`, `/v1/config`, `/v1/tools`, `/v1/events` (SSE), `/v1/openapi.json`
- **Indexer** — walks markdown, parses, chunks, embeds, stores
- **Pluggable adapters** — `Walker`, `Parser`, `Chunker`, `Embedder`, `Store`, `SearchEngine`, `Reranker`
- **Deterministic foundation** — model-backed planning and reranking are optional; search falls back to BM25 + vector + RRF

## Status

**v0.2.x — CLI-first OSS.** Indexing, SQLite/sqlite-vec storage, concurrent
BM25 + embedding/vector retrieval, weighted RRF over a bounded candidate set,
path/heading signals, page-diversity backfill, optional intent, structured
ranking traces, benchmark tooling, HTTP routes, tool definitions, and
connectors are implemented. The engine is **CLI + API only** — the browser
viewer/editor is a Pro feature and lives outside this package. The default
planner and reranker remain zero-cost passthrough adapters.

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

See the [architecture overview](../../docs/architecture.md) for the full API surface.
