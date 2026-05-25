# remember — Design Spec (v1)

**Status:** Draft for review
**Date:** 2026-05-23
**Owner:** Aaron Kusch (aakusch)
**Repo:** `~/Desktop/Repos/remember/` (public OSS, MIT)

---

## 1. Product summary

**remember** is a local-first, open-source, AI-ready wiki platform. Markdown content lives in a git repo; a small Node/TypeScript engine indexes it with hybrid (BM25 + vector) search; a browser admin drives configuration, structural manipulation, and search. AI agents plug in via an HTTP API or drop-in tool definitions.

**Positioning:** "Your wiki. Your data. Your AI." Self-hosted, no cloud dependency, zero outbound calls by default.

**Freemium strategy:**
- **v1 (this build):** Free + open source. Runs entirely locally. No API keys required.
- **Future v2+ ("remember.dev cloud"):** Managed multi-tenant SaaS with hosted Postgres+pgvector, object storage, SSO, billing. Same codebase via adapter swaps. *Not built in v1.*

**Target audiences (v1):** Developers, AI tinkerers, privacy-conscious teams, anyone running Obsidian/markdown notes who wants AI agents to query them.

---

## 2. Goals & non-goals

### v1 goals

1. **One-liner install** — `npx @useremember/core init my-wiki && npx @useremember/core dev` to running wiki in <60 seconds.
2. **AI-plugs-in** — `GET /v1/search` semantic+keyword search; `GET /v1/tools` returns Anthropic/OpenAI-ready tool definitions.
3. **Browser admin** — first-run setup wizard, config editing, reindex, page/folder manipulation (delete, move, rename, create folder).
4. **File-canonical content** — markdown in a git repo is the source of truth; editing happens in the user's editor.
5. **Pluggable everything** — every pipeline component (walker, parser, chunker, embedder, store, search engine, reranker) is an adapter interface with a documented contract.
6. **Zero outbound by default** — local onnx embedder, SQLite+sqlite-vec store, no telemetry.

### v1 non-goals

- In-browser markdown editing (v1.2)
- Authentication / RBAC (v1.3)
- Brand/theme customization (v1.2)
- Page schemas / typed frontmatter (v1.2)
- Cloud hosting / multi-tenancy (v2)
- Mobile-first UX
- Real-time collaborative editing

---

## 3. Architecture overview

```
~/my-knowledge/                       (user's content repo)
  content/                            (markdown — canonical)
  remember.config.ts                  (typed config)
  .remember/                          (generated, gitignored)
    index.db                          (SQLite + sqlite-vec)
    models/                           (cached onnx model)

       ┌─────────────────┐                 ┌──────────────────┐
       │  @useremember/core │   HTTP/JSON     │ @useremember/viewer │
       │  • CLI          │ ◄──────────────►│  • Astro + React │
       │  • Indexer      │     SSE         │  • Renders MD    │
       │  • Embedder     │                 │  • Search UI     │
       │  • Search       │                 │  • Admin (setup, │
       │  • HTTP API     │                 │    settings,     │
       │  • SQLite/vec   │                 │    reindex, ops) │
       └─────────────────┘                 └──────────────────┘
```

**Two packages, one monorepo (pnpm workspaces).** Clients run `npx @useremember/core dev` and both processes start. The seam matters: `core` is headless and knows nothing about UI; `viewer` is just a client of core's HTTP API. This is what enables the future cloud product (same core, different adapters + multi-tenant layer above).

---

## 4. Packages

### `@useremember/core`

Headless engine. Pure Node + TS.

- **CLI** (`bin/remember`) — `init`, `dev`, `start`, `index`, `status`
- **Indexer** — walks content, parses, chunks, embeds, stores
- **HTTP API** — Hono server, JSON, OpenAPI auto-generated at `/v1/openapi.json`
- **Adapters** (all sub-exports): `@useremember/core/walkers/*`, `embedders/*`, `chunkers/*`, `stores/*`, `search/*`, `rerankers/*`
- **Config loader** — Zod-validated `remember.config.ts`; writes back via AST edit (preserves comments)

### `@useremember/viewer`

Astro site with React islands for the interactive admin surface.

- `/` — landing (configured page)
- `/[...slug]` — render any markdown page
- `/search` — search UI (calls core `/v1/search`)
- `/admin/setup` — first-run wizard
- `/admin/settings` — edit `remember.config.ts` via UI (PUT `/v1/config`)
- `/admin/index` — reindex button + live status (subscribes `/v1/events`)
- `/admin/diagnostics` — health, model info, version, debug toggles

Admin routes default to localhost-only; remote access requires `REMEMBER_ADMIN_TOKEN`.

---

## 5. Pipeline (all components are pluggable adapters)

| Adapter | Interface | v1 default | Future options |
|---|---|---|---|
| `Walker` | `walk(): AsyncIterable<{path, content, mtime, sha256}>` | `chokidar` + .gitignore + `.rememberignore` | git-aware walker |
| `Parser` | `parse(raw): {frontmatter, ast, plain}` | `remark` + `gray-matter` | micromark, custom |
| `Chunker` | `chunk(parsed): Chunk[]` | smart-split (900 tokens, 15% overlap, heading-boundary-aware) | AST-aware (code), sentence-boundary |
| `Embedder` | `embed(texts): number[][]` | local onnx (`BAAI/bge-small-en-v1.5`, 384-dim) | OpenAI, Voyage, Cohere, custom HTTP |
| `Store` | `upsert/delete/search/manifest` | `sqlite-vec` (`better-sqlite3`) | pgvector (v2), in-memory |
| `SearchEngine` | `query(q, opts): Result[]` | hybrid BM25 + vector with RRF fusion (modeled on `tobi/qmd`) | vector-only, BM25-only |
| `Reranker` | `rerank(q, candidates): scored[]` | **none** (passthrough) in v1 | local cross-encoder (transformers.js) in v1.1; LLM-based later |

**Indexing semantics:** incremental by default. Manifest tracks each file's sha256; only changed files are re-chunked/re-embedded. Model change → full re-embed (UI prompts user).

**Watch mode:** `chokidar` over `content/`, 500ms debounce, SSE-pushed to viewer.

**Default ignores:** `drafts/**`, `_*/**`, `node_modules/**`, `.git/**`, plus user `.rememberignore`.

---

## 6. Search method (adopted from QMD)

```
GET /v1/search?q=<query>&k=10&debug=0

[1] Query expansion (optional, v1.1)
[2] parallel:
       ├── BM25 retrieve top 50      (sqlite FTS5)
       └── Vector retrieve top 50    (sqlite-vec)
[3] Reciprocal Rank Fusion → candidates[20]
[4] Reranker (optional; v1 = passthrough)
[5] Return { results, query_ms, debug? }
```

Each result includes: path, chunk_idx, snippet (highlighted), frontmatter, score, which retrievers surfaced it, stable `chunk_id`.

`?debug=1` returns per-stage timings + which retriever produced each candidate + RRF scores. Powers admin diagnostics.

---

## 7. HTTP API contract

All endpoints under `/v1/`. JSON by default; `?format=text` returns markdown for AI consumption. Stable error codes.

### Search & retrieval

- `GET /v1/search?q=&k=&debug=` — primary search
- `GET /v1/pages?cursor=&limit=&filter[<key>]=<value>` — list with cursor pagination, frontmatter filters
- `GET /v1/pages/<path>?format=json|text|html` — one page
- `GET /v1/pages/<path>/chunks` — debug

### Mutations (structural, not content)

- `DELETE /v1/pages/<path>`
- `POST /v1/pages/move` `{from, to}`
- `POST /v1/folders` `{path}`
- `DELETE /v1/folders/<path>?recursive=true`
- `POST /v1/folders/rename` `{from, to}`

All paths validated against `content/` root (path-traversal hardened). Filesystem op first, then index reconciliation. **Git is hands-off** — viewer shows "N unstaged changes" banner after mutations; user commits manually.

### Index lifecycle

- `POST /v1/index` `{mode: "incremental" | "full"}`
- `GET /v1/status` — index state, chunk count, model, watcher health

### Config

- `GET /v1/config`
- `PUT /v1/config` `{patch}` — Zod-validated, AST-edited write, returns `{ok, restart_required}`

### Realtime

- `GET /v1/events` (SSE) — `index.*`, `page.changed`, `config.updated`

### Tool definitions for AI agents

- `GET /v1/tools` — returns Anthropic/OpenAI-compatible tool defs for `search_wiki`, `get_page`, `list_pages`. Drop-in for any LLM tool-use API.

### Health & meta

- `GET /v1/health`
- `GET /v1/openapi.json` — auto-generated spec

### Auth

| Group | Default | With `REMEMBER_ADMIN_TOKEN` |
|---|---|---|
| `GET /v1/search`, `/v1/pages/*`, `/v1/health`, `/v1/openapi.json`, `/v1/tools` | open on localhost | optionally token-gated |
| All mutations + `/v1/config` + `/v1/events` | localhost-only | required Bearer token |

Default bind: `127.0.0.1`. Explicit `--host 0.0.0.0` requires admin token, else refuses with hint.

### Error format

```json
{ "error": { "code": "PATH_OUTSIDE_CONTENT", "message": "...", "hint": "..." } }
```

---

## 8. Config schema (`remember.config.ts`)

```typescript
import { defineConfig, defaults } from '@useremember/core'

export default defineConfig({
  name: 'My Knowledge Base',
  content: './content',
  server: {
    host: '127.0.0.1',
    port: 4321,           // viewer
    apiPort: 4320,        // core API
    adminToken: null,
  },
  pipeline: {
    walker:   defaults.walker.chokidar({ respectGitignore: true }),
    parser:   defaults.parser.remark(),
    chunker:  defaults.chunker.smartSplit({ size: 900, overlap: 0.15 }),
    embedder: defaults.embedder.localOnnx({ model: 'BAAI/bge-small-en-v1.5' }),
    store:    defaults.store.sqliteVec({ path: '.remember/index.db' }),
  },
  search: {
    engine: defaults.search.hybrid({
      bm25:   { enabled: true, weight: 0.5 },
      vector: { enabled: true, weight: 0.5 },
      fusion: 'rrf',
      rerank: defaults.rerank.none(),
      topK: 20, finalK: 10,
    }),
  },
  index: {
    watchMode: 'on',
    debounceMs: 500,
    onStaleModel: 'prompt',
  },
  viewer: {
    landing: 'README.md',
    showAdmin: true,
    breadcrumbs: true,
  },
  schemaVersion: 1,
})
```

Every field defaultable. Minimal valid config: `defineConfig({})`.

### ENV overrides (precedence: ENV > config > defaults)

`REMEMBER_CONTENT`, `REMEMBER_PORT`, `REMEMBER_API_PORT`, `REMEMBER_HOST`, `REMEMBER_ADMIN_TOKEN`, `REMEMBER_EMBED_MODEL`, `OPENAI_API_KEY` (activates OpenAI embedder when set).

---

## 9. Install & onboarding UX

```bash
# Zero-state install
npx @useremember/core init my-wiki
cd my-wiki
npx @useremember/core dev
# → opens browser to http://localhost:4321/admin/setup
# → wizard: content dir, embedding model (default: local), port, optional admin token
# → first index runs → wiki live
```

**Generated by `init`:**

```
my-wiki/
  content/
    README.md                  (welcome page)
    examples/                  (3 sample pages so search returns something on first run)
  remember.config.ts
  .gitignore                   (includes `.remember/`)
  .rememberignore              (defaults: `drafts/**`, `_*/**`)
  package.json                 (with `dev` and `start` scripts)
```

**Distribution v1:**
- npm: `@useremember/core` (primary)
- Docker: `ghcr.io/<owner>/remember` (also v1 — acceptance criteria require it)

**v1.1+ distribution:** Homebrew tap, standalone Bun-compiled binary, `curl install.remember.dev | sh` one-liner.

**TBD before scaffolding:** GitHub owner/org (`<owner>` placeholder throughout) and npm scope ownership (`@remember` likely available but needs to be claimed).

---

## 10. Testing approach

- **Stack:** Vitest + Playwright
- **Adapter contract tests** — every adapter interface ships a contract test suite all implementations must pass
- **Unit (60%) — Integration (30%) — HTTP (10%)** with one E2E smoke test for the install golden-path
- **Fixtures:** `tests/fixtures/sample-wiki/` doubles as the `remember init --template sample` content
- **CI:** GitHub Actions on PR — lint, typecheck, all test tiers; Node 20+22, macOS+Ubuntu; <3min full
- **Merge gates:** all green, coverage ≥80% on `core/`, no new `any`

---

## 11. Security model (v1)

- **Default bind:** `127.0.0.1` only
- **Path-traversal hardening:** every mutation path normalized + verified under `content/` root; symlinks not followed
- **Admin token:** required for any remote (non-localhost) access or any mutation when bind is non-loopback
- **No telemetry by default**; opt-in `--telemetry` flag posts anonymous version + error counts to a single endpoint (v1.1)
- **Dependencies:** SBOM published in releases; `npm audit` gate in CI

---

## 12. Roadmap

| Version | Highlights |
|---|---|
| **v1.0** | This spec — lean local-first OSS |
| **v1.1** | Cross-encoder reranker; brew tap; standalone binary; curl install one-liner; hybrid retriever tuning |
| **v1.2** | In-browser markdown editing; page schemas (Astro content collections style); brand/theme |
| **v1.3** | RBAC + OIDC/SAML auth providers |
| **v2.0** | **Cloud premium** — multi-tenant managed SaaS; pgvector + S3 adapters; Stripe billing; team workspaces |

---

## 13. Repository layout (target after scaffolding)

```
remember/
  packages/
    core/
      bin/
      src/
        cli/
        indexer/
        embedders/    (sub-exports)
        chunkers/
        walkers/
        stores/
        search/
        rerankers/
        api/          (Hono routes)
        config/
      tests/
      package.json
    viewer/
      src/
        pages/
        components/
        lib/api-client/
      astro.config.mjs
      package.json
  docs/
    superpowers/specs/      (this file)
    site/                   (remember.dev — built with remember itself)
  examples/
    sample-wiki/
  tests/
    fixtures/
  .github/workflows/
  pnpm-workspace.yaml
  package.json
  README.md
  LICENSE                  (MIT)
```

---

## 14. Open risks & mitigations

| Risk | Mitigation |
|---|---|
| `sqlite-vec` is young; behavior may shift across versions | Pin exact version; adapter interface lets us swap to `hnswlib-node` if needed |
| Local onnx model adds ~80MB to first-run | Document upfront; cache aggressively in `.remember/models/`; optional pre-bundled tarball variant |
| Two-package workspace adds release coordination | Conventional-commits + changesets automate versioning + changelog |
| OSS dogfooding (`remember.dev` built with `remember`) is a quality forcing function but also a blocker if `remember` regresses | Stage docs builds on PR; rollback path documented |
| Future cloud premium adapters depend on adapter interface stability | Adapter contract tests + semver discipline; major bumps for any breaking adapter change |

---

## 15. Acceptance criteria for v1.0

A user can:

1. Run `npx @useremember/core init my-wiki` and get a working scaffold in <10 seconds
2. Run `npx @useremember/core dev`, complete the browser setup wizard, and see search results from sample content in <2 minutes from zero
3. Drop a new markdown file in `content/`, see it auto-indexed in <1 second, and find it via `/v1/search`
4. Hit `GET /v1/search?q=...` from `curl` and get RRF-fused hybrid results with paths + snippets
5. Hit `GET /v1/tools` and get Anthropic-compatible tool definitions ready to drop into a Claude tool-use call
6. Use the viewer admin to delete a page, move a page, rename a folder — and see the search index reconcile immediately
7. Run `OPENAI_API_KEY=sk-... npx @useremember/core dev` and have OpenAI embeddings activate, with a model-stale banner prompting full re-embed
8. Run inside Docker without modification (`docker run -v ./content:/app/content -p 4321:4321 ghcr.io/.../remember`)

---

*End of spec.*
