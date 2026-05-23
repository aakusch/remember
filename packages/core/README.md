# @remember/core

Headless engine for the [`remember`](../../README.md) wiki platform. Provides:

- **CLI** (`remember init | dev | start | index | status`)
- **HTTP API** (Hono) — `/v1/search`, `/v1/pages`, `/v1/index`, `/v1/config`, `/v1/tools`, `/v1/events` (SSE), `/v1/openapi.json`
- **Indexer** — walks markdown, parses, chunks, embeds, stores
- **Pluggable adapters** — `Walker`, `Parser`, `Chunker`, `Embedder`, `Store`, `SearchEngine`, `Reranker`

## Status

**v0.0.1 — scaffold.** Adapter interfaces in place; concrete implementations land progressively. The Hono app responds to `/v1/health` and returns 501 for not-yet-implemented endpoints.

## Use as a library

```ts
import { defineConfig, defaults } from '@remember/core';

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
