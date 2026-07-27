# Changelog

All notable changes to this project. Format inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) starting at v1.0.

## [0.2.0] - 2026-07-27

The open-source engine becomes **CLI + API only**. The browser UI is now a
**Pro** feature; the previously-published `@useremember/viewer` npm package is
**deprecated** and is no longer part of the OSS product. The terminal CLI is
now the OSS user experience, and it got a substantial build-out.

### Added

- **`remember search "<query>"`** — first-class hybrid search from the terminal
  (previously only available over HTTP). Formatted result cards with rank,
  score, path, title, and a query-relevant snippet with matched terms
  highlighted. Flags: `-k <n>`, `--json` (clean, color-free machine output for
  scripts and agents), `--open` (open the top result in `$EDITOR`/`$PAGER`).
- **Rich, consistent CLI formatting** across `init`, `dev`, `start`, `index`,
  and `status`: aligned columns, section headers, a restrained color palette,
  and clear success/error states. `status` is now a tidy dashboard (page count,
  chunk count, model, index freshness).
- **Well-formatted help**: `remember help`, `remember help <command>`, and
  `remember <command> --help`, each with real examples.
- Color support respects `NO_COLOR` and auto-disables on non-TTY output
  (pipes, redirects, CI logs).

### Changed

- **The browser UI moved to Pro.** OSS ships CLI + API only. `remember dev` now
  starts the API + file watcher and prints a clean CLI-focused startup block —
  no browser-UI framing, no "install `@useremember/viewer`" hint.
- `remember init` scaffolds a CLI/API product: the generated `package.json` no
  longer depends on `@useremember/viewer`, and the generated `remember.config.ts`
  and seeded docs read as a CLI + API product. Much lighter install (no Astro,
  no `@astrojs/node`).
- Single-sourced version bumped to `0.2.0` (CLI, HTTP API `/v1/health`,
  OpenAPI).

### Removed

- `packages/viewer` (`@useremember/viewer`) is removed from the OSS repository,
  workspace, CI, Docker image, and scaffold. The published npm package is
  deprecated (see note above).

### Fixed

- **Model-download progress** is now clean on both a TTY (a single overwriting
  line) and a non-TTY/pipe (throttled, one line per file per 10% step, one
  `100%` per file). Previously, piping `remember dev`/`remember index` to a file
  spammed hundreds of repeated `tokenizer.json: 100%` lines.

## [0.1.0] - 2026-07-23

### Added

- Versioned 30-query retrieval benchmark with deterministic CI and local-BGE
  release profiles, per-query/class results, comparison deltas, and a recall
  regression gate.
- Optional typed query intent and a zero-cost passthrough `QueryPlanner`.
- Structured ranking traces with planner variations, candidate counts, RRF
  contributions, metadata signals, result IDs, fallbacks, and stage timings.
- Provider-neutral, token-bounded evidence-package contract with stable
  citation IDs, access-boundary filtering, conflicts, and gaps.

### Changed

- Weighted RRF now consumes configured BM25/vector weights and fuses to a
  candidate limit rather than the final result limit.
- Search now overlaps BM25 work with the embedding/vector branch, applies
  boosts and chunk deduplication before bounded reranking, then performs page
  diversity and backfill before the final slice.
- Planner and reranker failures fall back to deterministic original-query
  search without exposing provider error details.

### Fixed

- SQLite search results now retain `heading_path`, activating the documented
  heading relevance signal.
- Page deduplication can backfill enough distinct pages to satisfy `k` when
  candidates are available.

## [0.0.1] - 2026-05-25

First published release of `@useremember/core` and `@useremember/viewer` (npm 0.0.1).

### Added — Wave 5: Editor + nav + table view
- **Slash commands in editor** — 20 commands (`/h1`-`/h4`, `/bullet`, `/numbered`, `/todo`, `/code`, `/code-ts/py/sh`, `/quote`, `/table`, `/hr`, `/link`, `/image`, `/math`, `/mermaid`, `/frontmatter`, `/tag`). Keyboard-navigable popup with filter-as-you-type. `Cmd/Ctrl+S` to save.
- **Multi-tab bar** — sticky tab strip below the header. Persisted in localStorage. Up to 12 tabs, click × to close one, Clear to wipe all.
- **`/admin/views` table view** — query frontmatter as a sortable, filterable table. 4 preset cards (Runbooks by severity, ADRs newest first, Platform-owned, Recently modified).
- **`GET /v1/pages` frontmatter-aware** — accepts `?filter[<key>]=<value>` (repeatable, AND-joined), `?sort=<key>|-<key>`, `?q=<text>`, `?limit + ?offset|?cursor`. Returns title, frontmatter, last_indexed on each row.
- **`GET /v1/attrs`** — distinct list of frontmatter keys discovered in the corpus; powers the column picker.
- **`pages` + `page_attrs` SQLite tables** — frontmatter flattened for fast indexed filtering.
- **Remote-read auth gating** — when `REMEMBER_ADMIN_TOKEN` is set, non-loopback GETs now require the token too (not just mutations).

### Added — Wave 4: Connectors + editor + watcher
- **Connector framework** — pluggable adapter for pulling external sources into `content/external/<name>/`.
  - `defaults.connector.obsidian({ vaultPath, transformWikilinks, tag })`
  - `defaults.connector.granola({ apiUrl, apiKey, since, includeTranscript })` (or pass a `fetchMeetings` callback)
  - `defaults.connector.filesystem({ sourcePath })`
- **`/v1/connectors` API** — list connectors + per-connector sync trigger + batch sync.
- **`/admin/connectors` viewer page** — status cards, manual sync, config snippets in empty state.
- **In-browser markdown editor** at `/admin/edit/<path>` — split-pane source + live preview via `marked`. ✎ Edit pill on every page detail.
- **File watcher** — chokidar over `content/`, 500ms debounced incremental reindex on any add/change/unlink.
- **SSE `/v1/events`** — `connected`, `heartbeat`, `index.started`, `index.completed`, `page.changed`, `page.saved`, `connector.synced`.
- **Viewer SSE auto-reload** — open viewer tabs refresh when their page changes on disk.
- **`PUT /v1/pages/<path>`** — write markdown + reindex that one file. `safeJoinContent` path-traversal hardened.

### Added — Wave 3: Setup wizard + Save to disk
- **`/admin/setup` wizard** — preset profiles (Local quickstart, Lightweight local, OpenAI-powered, Team/remote), embedding-model dropdown, "CHANGED" pill on diff'd fields.
- **`PUT /v1/config`** — writes the full `remember.config.ts` to disk with a timestamped `.bak` backup. Validates source contains a `defineConfig(...)` call.
- **`GET /v1/config`** — returns loaded config + paths.

### Added — Wave 2: Admin section
- `/admin` dashboard with stat cards.
- `/admin/reindex` — incremental + full reindex with live status table.
- `/admin/settings` — read-only config display (4 grouped sections).
- `/admin/diagnostics` — API health, OpenAPI route enumeration, AI tool defs.
- `/admin/files` — folder + page tables with move/delete/rename/create-folder forms.
- Sidebar nav with active-state highlighting.
- Layout polish — sticky header (64px), persistent 264px sidebar, light/dark via `prefers-color-scheme`, CSS variables ready for v0.3 theming.
- TOC sidebar with sticky positioning + indented per heading level.
- Breadcrumbs, tag badges, prev/next nav, last-modified timestamp on every page.

### Added — Wave 1: v1 indexer + hybrid search + HTTP API
- Walker (chokidar), Parser (remark + gray-matter), Chunker (smart-split, 900 tokens / 15% overlap), Store (sqlite-vec + FTS5), Indexer (sha256-based incremental).
- Embedder: local-onnx via `@huggingface/transformers` (default `BAAI/bge-small-en-v1.5`, 384-d) + OpenAI (`text-embedding-3-small`) + hash (deterministic test fallback).
- SearchEngine: hybrid BM25 + vector with Reciprocal Rank Fusion (modeled on `tobi/qmd`).
- Reranker: passthrough (cross-encoder slot reserved for v0.1).
- HTTP API via Hono: `/v1/health`, `/v1/openapi.json`, `/v1/search`, `/v1/pages`, `/v1/pages/<path>`, `/v1/status`, `/v1/tools`, `/v1/index`, structural mutations on pages + folders, OpenAPI route enumeration.
- CLI: `remember init`, `remember dev`, `remember start`, `remember index`, `remember status`.
- Astro 5 + node-SSR viewer — landing, `/[...slug]` page detail, `/search` UI.
- Scaffold + sample-wiki + design spec.

---

## Build history

- **`6acf7f9`** wave 5 — slash commands, multi-tab bar, table view, frontmatter-aware /v1/pages, remote-read gating
- **`a520094`** docs(viewer/connectors): correct path in footer
- **`dcfba36`** wave 4 (part b) — connectors framework + Obsidian + Granola + filesystem
- **`053cbcc`** content — populate sample-wiki with 16 realistic pages
- **`be467e3`** wave 4 (part a) — in-browser editor, file watcher, SSE live-reload
- **`173a1aa`** wave 3 (part c) — setup wizard presets + model dropdowns + diff indicators
- **`7abecdc`** wave 3 (part b) — PUT /v1/config writes to disk; Save button
- **`a1f2093`** wave 3 (part a) — /admin/setup wizard with config preview
- **`de27e77`** wave 2 (part b) — spacing, layout, card styling fix (Astro is:global)
- **`49256ee`** wave 2 (part a) — full admin section, sidebar nav, TOC, breadcrumbs, structural ops
- **`d8ad612`** wave 1 — v1 indexer, hybrid search, HTTP API, Astro viewer
- **`b684301`** scaffold — v1 repo skeleton
- **`3ba424a`** spec — initial v1 design
