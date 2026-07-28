# Architecture

A condensed view of how `remember` is built. For the retrieval pipeline in depth, see [`retrieval-intelligence.md`](./retrieval-intelligence.md).

## One package, one monorepo

```
remember/
├─ packages/
│  └─ core/      @useremember/core    — headless engine (CLI + HTTP API)
└─ examples/
   ├─ sample-wiki/   reference wiki used in tests + by remember init
   └─ sample-vault/  mock Obsidian vault for the connector demo
```

- **`@useremember/core`** is the whole open-source engine. CLI + HTTP API + indexer + search + adapters. Node-only. Standalone-usable — drive it from the terminal, from `curl`, or from any agent that speaks HTTP.

> The browser viewer/editor is a **Pro** feature (a self-hosted engine that adds a browser UI and quality levers on top of this same core) and lives outside this repository. The open-source engine is CLI + API only.

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
        │                @useremember/core             │
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
          ┌──────────────┼───────────────┐
          ▼              ▼               ▼
   ┌─────────────┐ ┌───────────┐ ┌───────────────┐
   │ remember    │ │ curl /    │ │ AI agent via  │
   │ CLI (search)│ │ any HTTP  │ │ /v1/tools     │
   └─────────────┘ └───────────┘ └───────────────┘
```

## Pipeline adapters

Every component of the indexing pipeline is an adapter with a documented interface in `packages/core/src/types.ts`:

| Adapter | Interface | Default | Sub-export |
|---|---|---|---|
| `Walker` | `walk(root): AsyncIterable<{path, content, mtime, sha256}>` | chokidar + ignore | `@useremember/core/walkers/chokidar` |
| `Parser` | `parse(raw): {frontmatter, ast, plain}` | remark + gray-matter | `@useremember/core/parsers/remark` |
| `Chunker` | `chunk(parsed): Chunk[]` | smart-split (900 tokens, 15% overlap) | `@useremember/core/chunkers/smart-split` |
| `Embedder` | `embed(texts): number[][]` | local ONNX (`BAAI/bge-small-en-v1.5`) | `@useremember/core/embedders/local-onnx`, `/openai`, `/hash` |
| `Store` | `upsert/delete/searchVector/searchBm25/getManifest/upsertPage/queryPages/listFrontmatterKeys` | SQLite + sqlite-vec | `@useremember/core/stores/sqlite-vec` |
| `SearchEngine` | `query(q, opts): {results, query_ms, trace?}` | hybrid BM25+vector with weighted RRF | `@useremember/core/search/hybrid` |
| `QueryPlanner` | `plan({query, intent?}): QueryPlan` | deterministic passthrough | `@useremember/core/query-planners/passthrough` |
| `Reranker` | `rerank(query, candidates, context): scored[]` | deterministic passthrough; model-backed candidates gated | `@useremember/core/rerankers/none` |
| `Connector` | `sync(ctx): ConnectorSyncResult` | none (opt-in via config) | `@useremember/core/connectors` |

The default implementations are wired automatically when `loadConfig()` runs. Override any of them in `remember.config.ts`:

```ts
import { defineConfig, defaults } from '@useremember/core';
import { createOpenAIEmbedder } from '@useremember/core/embedders/openai';

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
1. Passthrough query plan by default
2. BM25 overlaps with embed → vector retrieval
3. Weighted Reciprocal Rank Fusion to candidateK
4. Exact, path, and heading signals
5. Chunk deduplication
6. Bounded reranker (passthrough by default)
7. Page diversity with backfill
8. Slice to finalK
9. Return { results, query_ms, trace? }
```

Each result includes path, chunk_idx, snippet, frontmatter, score, retrievers (`['bm25', 'vector']`), and a stable chunk_id (`<path>#<idx>`).

`?debug=1` adds a structured ranking trace: normalized query/intent, planner
variations, retriever candidate counts, per-result RRF contributions and
metadata signals, IDs before/after reranking, fallback reason, and per-stage
timings. It exposes scoring evidence, never hidden model reasoning.

### Phase 1 correction

v0.1 adds the versioned benchmark, overlaps BM25 with the embedding/vector
branch, fuses to a wider candidate set, applies configured retriever weights,
performs boosts/chunk-deduplication/reranking before final truncation, and
backfills distinct pages. The planner and reranker seams are implemented, but
their defaults remain deterministic passthrough adapters.

### Search and planned Answer extensions

The deterministic pipeline remains the default and fallback. Search accepts
optional query intent, and optional adapters may add local or remote query
expansion and bounded reranking before results are returned. They do not
replace BM25/vector retrieval or send the entire corpus to a model.

Cloud may use the ranked evidence to produce a separately metered, cited
answer before a downstream agent spends its own context. Provider routing,
answer generation, and billing remain Cloud concerns; reusable planning,
reranking, evaluation, and citation contracts belong in the core.

See [`retrieval-intelligence.md`](./retrieval-intelligence.md) for the design
direction and rollout rules.

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

Localhost reads stay open by default to keep the zero-config local CLI and
agent experience friction-free.

## Performance characteristics

Everything runs locally and in-process — there is no network hop on the search
path. Practical characteristics:

- **First index** downloads the embedding model once (`BAAI/bge-small-en-v1.5`, ~100 MB), then caches it; every index after that is offline.
- **Indexing is incremental** — a sha256 manifest means only changed files are re-parsed, re-embedded, and re-stored.
- **Search is local** — BM25 (SQLite FTS5) and vector (sqlite-vec) retrieval run against the on-disk index with no external service.

Formal, reproducible benchmark numbers for the shipped 0.2.0 engine are not yet
published; run the versioned harness (`remember benchmark`, see
[`benchmarks/retrieval/README.md`](../benchmarks/retrieval/README.md)) against
your own corpus to measure recall, latency, and rank quality on hardware you
control.

## Storage layout

`.remember/` lives next to your config and is gitignored:

```
.remember/
  index.db                       SQLite — chunks, embeddings, FTS, manifest, pages
  models/                        Cached ONNX model files (~100MB+ depending on model)
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
| Retrieval intelligence | optional local planner/reranker | hosted planner/reranker + cited answers |
| Multi-tenancy | n/a | new `Tenant` adapter wrapping requests |
| Billing | n/a | Stripe middleware |

Same codebase, different adapter set, plus a thin multi-tenant layer. The whole pipeline is designed around this transition.
