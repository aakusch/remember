# @useremember/core

Headless retrieval engine for [`remember`](../../README.md). It turns Markdown
into ranked, source-cited evidence for humans and agents. Provides:

- **CLI** — `setup | init | index | search | get | list | status | doctor | mcp | tools | capabilities | dev | start`. Formatted output for humans, stable `--json` on every read command for agents.
- **MCP server** (`remember mcp`) — stdio, so Claude Code / Desktop, Cursor, Codex and any MCP client drive the wiki as native tools.
- **HTTP API** (Hono, optional) — `/v1/search`, `/v1/pages`, `/v1/status`, `/v1/doctor`, `/v1/capabilities`, `/v1/tools`, `/v1/openapi.json`.
- **Indexer** — walks Markdown (plus optional PDF and Office formats), parses, chunks, embeds, stores.
- **Pluggable adapters** — `Walker`, `Parser`, `Chunker`, `Embedder`, `Store`, `SearchEngine`, `Reranker`.
- **Deterministic foundation** — planning and reranking are zero-cost passthrough by default; retrieval is BM25 + vector + RRF.

## Status

**v0.3.1 local release candidate — not yet published; npm `latest` is 0.3.0.** This CLI- and
MCP-first OSS candidate includes indexing, SQLite/sqlite-vec storage,
concurrent BM25 + vector retrieval, weighted RRF over a bounded candidate set,
path/heading signals, page-diversity backfill, structured ranking traces,
corpus-health `doctor`, machine-readable `capabilities`, benchmark tooling, and
a native MCP server are implemented. The default planner and reranker are
zero-cost passthrough adapters.

The engine is **CLI + MCP + optional HTTP** — the browser viewer/editor is a Pro
feature and lives outside this package. Built-in connectors were removed in
0.3.0: the corpus is plain Markdown on disk, so your agent (or you) writes into
`content/`. The inert `intent` search parameter is accepted for compatibility
but reaches no stage.

### What it needs to run

Node ≥ 20, macOS or Linux. Windows is not yet verified — CI runs it, but as an
informational job (two native modules plus an ONNX runtime; prebuilt binaries
are not guaranteed for every target).

**Indexing needs roughly 2 GB of free memory.** The embedding model runs in
native memory outside the JS heap, so `--max-old-space-size` does not cap it,
and the requirement is nearly flat in corpus size — measured peak RSS was about
0.7 GB on 3 documents and 1.75 GB on 496. Size containers accordingly. Searching
an existing index is far cheaper; the cost is the indexing pass.

Measured on a 496-document, 2.3 MB Markdown vault (macOS ARM, Node 20,
`bge-small-en-v1.5`): full index 113s → 3,117 chunks in an 11 MB database;
one changed file re-indexed in 360ms; one deleted file in 42ms; warm search
p50 6ms.

### Honest boundary

A result means the corpus contains text that ranked for the query — **not** that
an answer exists. There is no abstention: one was built, measured, and removed
because no threshold proved trustworthy across corpus shapes, so the engine
never withholds a result and never signals "I don't know". `score` is a fused
rank score, comparable only within one result set — never a probability.

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
