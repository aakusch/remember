# Architecture

A condensed view of how `remember` is built. The full design rationale lives in [`docs/superpowers/specs/2026-05-23-remember-platform-design.md`](./superpowers/specs/2026-05-23-remember-platform-design.md).

## Two packages, one monorepo

```
remember/
├─ packages/
│  ├─ core/      @remember/core    — headless engine
│  └─ viewer/    @remember/viewer  — Astro browser UI
└─ examples/
   ├─ sample-wiki/   reference wiki used in tests + by remember init
   └─ sample-vault/  mock Obsidian vault for the connector demo
```

- **`@remember/core`** is the engine. CLI + HTTP API + indexer + search + adapters. Node-only. Can be used standalone with any UI.
- **`@remember/viewer`** is the default browser UI. Astro 5 SSR + tiny inline scripts. Talks to core over HTTP/JSON + SSE. Optional — bring your own UI if you want.

## Data flow

```
┌─────────────────────────────────────────────────────────────────┐
│ User's wiki directory: ~/my-wiki/                               │
│   content/**/*.md             ← canonical markdown               │
│   remember.config.ts          ← typed config                     │
│   .remember/index.db          ← SQLite + sqlite-vec (gitignored) │
│   .remember/cache/            ← downloaded ONNX model            │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────────┐
        │                @remember/core             │
        │                                           │
        │  ┌─────────────┐                          │
        │  │ chokidar    │ watches content/         │
        │  │ watcher     │ → debounced reindex      │
        │  └──────┬──────┘                          │
        │         ▼                                 │
        │  ┌──────────────────────────────────────┐ │
        │  │  Indexer:                            │ │
        │  │   Walker → Parser → Chunker →        │ │
        │  │   Embedder → Store                   │ │
        │  └──────────────────────────────────────┘ │
        │         │                                 │
        │         ▼                                 │
        │  ┌──────────────────┐                     │
        │  │ SQLite database  │                     │
        │  │  • chunks (text) │                     │
        │  │  • vec_chunks    │ ← sqlite-vec        │
        │  │  • fts_chunks    │ ← FTS5              │
        │  │  • pages         │ ← frontmatter       │
        │  │  • page_attrs    │ ← flattened k/v     │
        │  │  • manifest      │ ← sha256 tracking   │
        │  └──────────────────┘                     │
        │         ▲                                 │
        │         │                                 │
        │  ┌──────┴──────────────────────────────┐  │
        │  │ Hono HTTP API on :4320 + SSE        │  │
        │  └──────────────────────────────────────┘  │
        └────────────────┬──────────────────────────┘
                         │ HTTP/JSON + SSE
                         ▼
              ┌───────────────────────┐
              │   @remember/viewer    │
              │   (Astro on :4321)    │
              └───────────────────────┘
                         ▲
                         │
                    ┌────┴────┐
                    │ Browser │
                    └─────────┘
```

## Pipeline adapters

Every component of the indexing pipeline is an adapter with a documented interface in `packages/core/src/types.ts`:

| Adapter | Interface | Default | Sub-export |
|---|---|---|---|
| `Walker` | `walk(root): AsyncIterable<{path, content, mtime, sha256}>` | chokidar + ignore | `@remember/core/walkers/chokidar` |
| `Parser` | `parse(raw): {frontmatter, ast, plain}` | remark + gray-matter | `@remember/core/parsers/remark` |
| `Chunker` | `chunk(parsed): Chunk[]` | smart-split (900 tokens, 15% overlap) | `@remember/core/chunkers/smart-split` |
| `Embedder` | `embed(texts): number[][]` | local ONNX (`BAAI/bge-small-en-v1.5`) | `@remember/core/embedders/local-onnx`, `/openai`, `/hash` |
| `Store` | `upsert/delete/searchVector/searchBm25/getManifest/upsertPage/queryPages/listFrontmatterKeys` | SQLite + sqlite-vec | `@remember/core/stores/sqlite-vec` |
| `SearchEngine` | `query(q, opts): {results, query_ms, debug?}` | hybrid BM25+vector with RRF fusion | `@remember/core/search/hybrid` |
| `Reranker` | `rerank(query, candidates): SearchResult[]` | passthrough (cross-encoder reserved for v0.1) | `@remember/core/rerankers/none` |
| `Connector` | `sync(ctx): ConnectorSyncResult` | none (opt-in via config) | `@remember/core/connectors` |

The default implementations are wired automatically when `loadConfig()` runs. Override any of them in `remember.config.ts`:

```ts
import { defineConfig, defaults } from '@remember/core';
import { createOpenAIEmbedder } from '@remember/core/embedders/openai';

export default defineConfig({
  pipeline: {
    embedder: createOpenAIEmbedder({ model: 'text-embedding-3-large' }),
    // walker/parser/chunker/store stay at defaults
  },
});
```

## Search architecture

```
GET /v1/search?q=<query>&k=10&debug=0
   │
   ▼
1. Query embedding (~2ms with the local model)
2. parallel:
     ├─ BM25 retrieve top 50      (sqlite FTS5)
     └─ Vector retrieve top 50    (sqlite-vec)
3. Reciprocal Rank Fusion (k=60 default) → 20 candidates
4. Reranker (passthrough in v1; cross-encoder in v0.1) → finalK
5. Return { results, query_ms, debug? }
```

Each result includes path, chunk_idx, snippet, frontmatter, score, retrievers (`['bm25', 'vector']`), and a stable chunk_id (`<path>#<idx>`).

`?debug=1` adds per-stage timings — useful for tuning and the diagnostics page.

## Connector framework

Connectors run inside the core process on startup and on demand. They write to `content/external/<connector-name>/`, where the file watcher picks them up just like any other markdown change.

```
remember.config.ts
   │
   ▼ defaults.connector.obsidian({...})
   │
   ▼
ConnectorManager
   ├─ obsidian.sync() ──▶ content/external/obsidian/
   ├─ granola.sync()  ──▶ content/external/granola/
   └─ filesystem.sync() ▶ content/external/<name>/
                                │
                                ▼
                          chokidar watcher
                                │
                                ▼
                          incremental reindex
                                │
                                ▼
                          searchable in <1s
```

## HTTP API surface

All endpoints under `/v1/`. JSON by default; `?format=text` returns raw markdown for AI consumption. Stable error codes.

| Endpoint | Purpose |
|---|---|
| `GET /v1/health` | Liveness check |
| `GET /v1/openapi.json` | OpenAPI route enumeration |
| `GET /v1/search?q&k&debug` | Hybrid search |
| `GET /v1/pages?filter[k]=v&sort=&q=&limit=&cursor=` | Frontmatter-aware page query |
| `GET /v1/pages/<path>?format=json\|text\|html` | One page |
| `PUT /v1/pages/<path>` | Write markdown + reindex |
| `DELETE /v1/pages/<path>` | Delete + reconcile index |
| `POST /v1/pages/move` | Move/rename page |
| `POST /v1/folders` | Create folder |
| `DELETE /v1/folders/<path>` | Delete folder (recursive opt) |
| `POST /v1/folders/rename` | Rename folder |
| `GET /v1/attrs` | Distinct frontmatter keys |
| `GET /v1/status` | Index stats |
| `POST /v1/index` | Trigger reindex |
| `GET /v1/config` | Read loaded config |
| `PUT /v1/config` | Write config with `.bak` backup |
| `GET /v1/connectors` | Connector list + status |
| `POST /v1/connectors/<name>/sync` | Trigger one connector |
| `POST /v1/connectors/sync` | Trigger all connectors |
| `GET /v1/events` | Server-Sent Events stream |
| `GET /v1/tools` | Anthropic/OpenAI tool definitions |

## Auth model

- **Bind defaults to `127.0.0.1`.** Localhost only by default.
- **`REMEMBER_ADMIN_TOKEN` env var** — when set, required for:
  - All mutations (POST/PUT/DELETE)
  - All reads from non-loopback origins (introduced in v0.0.1+ wave 5)
- **Non-loopback bind requires the token** — server refuses to start on `0.0.0.0` without it.

Localhost reads stay open by default to preserve the zero-config viewer.

## Performance characteristics

Measured on a 25-page sample wiki:

| Operation | Time |
|---|---|
| Initial index (cold, downloads model) | ~10-15s (~80MB model download) |
| Initial index (warm, model cached) | ~2-3s |
| Incremental index (no changes) | ~5ms |
| Single-file edit + reindex | ~100ms |
| Hybrid search query | ~2-5ms |
| Vector retrieve (top-K from sqlite-vec) | <1ms |
| BM25 retrieve (top-K from FTS5) | <1ms |

## Storage layout

`.remember/` lives next to your config and is gitignored:

```
.remember/
  index.db                       SQLite — chunks, embeddings, FTS, manifest, pages
  models/                        Cached ONNX model files (~80-440MB depending on model)
  connectors/                    Per-connector state (last sync time, etc.)
```

You can safely delete `.remember/` at any time. Next start will reindex from disk.

## Future architecture (v2 cloud)

The adapter interfaces are designed to support a multi-tenant cloud deployment without rewriting:

| Component | v1 local | v2 cloud |
|---|---|---|
| Store | `sqlite-vec` | `pgvector` (Postgres) |
| Content source | local filesystem | S3 / Cloudflare R2 |
| Auth | localhost-only / admin token | SSO via OIDC/SAML |
| Embeddings | local ONNX or OpenAI | same options + provider routing |
| Multi-tenancy | n/a | new `Tenant` adapter wrapping requests |
| Billing | n/a | Stripe middleware |

Same codebase, different adapter set, plus a thin multi-tenant layer. The whole pipeline is designed around this transition.
