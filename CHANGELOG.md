# Changelog

All notable changes to this project. Format inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) starting at v1.0.

## [Unreleased]

No changes yet.

## [0.3.1] - 2026-08-13

Local release candidate; not published. npm `latest` remains `0.3.0`. This candidate combines the
multi-format ingestion work below with a security and durability patch. It must not be described as
available until the packed artifact and publication have completed.

### Added

- **Multi-format ingestion** via [`@firecrawl/anydoc`](https://github.com/firecrawl/anydoc)
  (MIT, local Rust/napi — no network, no API key, no model): `.docx`/`.doc`/`.docm`,
  PowerPoint (`.ppt`/`.pptx`/…), Excel (`.xls`/`.xlsx`/…), OpenDocument
  (`.odt`/`.ods`/`.odp`), `.rtf`, `.epub`, and `.csv` — plus `.pdf` through
  [`@firecrawl/pdf-inspector`](https://github.com/firecrawl/pdf-inspector).
  Every format converts to
  markdown, so document headings populate `heading_path` and drive section-aware
  chunking exactly as markdown does.

  Opt in with `index.formats` in `remember.config.ts`, and install the optional
  peer dependency:

  ```ts
  // remember.config.ts
  export default { index: { formats: ['md', 'pdf', 'docx', 'pptx'] } };
  ```
  ```bash
  npm install @firecrawl/anydoc          # office formats
  npm install @firecrawl/pdf-inspector   # pdf
  ```

  `index.formats` **defaults to `['md']`**, so an existing install is unchanged
  until you opt in and a default install pulls no native binary. Verified against
  the committed deterministic gate: `recall@1/5/10` `0.507/0.853/0.927`, MRR
  `0.853`, `corpus_hash` unchanged.

  PDF gets its own parser rather than riding anydoc's, because pdf-inspector
  reports page classification, per-page OCR flags, font-encoding warnings and a
  recoverable document title — so a PDF that cannot be read tells you *why*.

  Scope, stated plainly: **native-text PDFs only** — a scanned or image-only PDF
  needs OCR, so it is recorded with no searchable text and named in a warning,
  and the engine never calls a cloud OCR service. A `Mixed` PDF indexes the text
  pages it has. Text extracted from fonts with no `ToUnicode` map may be garbled;
  that is reported as a warning and still indexed. Spreadsheets index as one line
  per row, so a large grid of bare numbers retrieves poorly. ODF presentations
  (`.odp`) carry no heading information, so their `heading_path` is empty where
  `.pptx` populates it. A corrupt or unreadable document degrades to an empty
  recorded page and never fails the indexing run.

### Changed

- `createFsWalker` accepts `extensions` / `binaryExtensions` and yields
  `content: string | Uint8Array`; `createIndexer` accepts either the legacy
  markdown `Parser` or the new multi-format `DocumentParser`. Existing callers
  passing `createRemarkParser()` keep working unchanged.
- The markdown format now also claims `.markdown`, which the walker previously
  skipped. This is the only behaviour change on the default path.

### Security

- Fail closed when a dangling or looping symlink under `content/` would otherwise be followed by a
  page write outside the configured content root.
- Stop putting the admin token and a privileged HTTP write instruction into the generated agent
  guide. The guide now leads with MCP/CLI access and filesystem-canonical writes.
- Compare configured admin tokens in constant time and retain the existing real-path containment
  checks.

### Fixed

- Make `full` reindex actually reprocess unchanged files, index on boot when the database is empty,
  and keep the Docker/Compose runtime aligned with the generated configuration.
- Give actionable recovery instructions for corrupt, incompatible, read-only, or locked derived
  index databases.
- Add durability coverage for interrupted indexes, corrupt databases, and concurrent readers.
- Add informational Windows CI while keeping Windows explicitly unverified for release support.
- Record measured indexing cost, including the roughly 2 GB free-memory requirement.

## [0.3.0] - 2026-08-02

Published to npm on 2026-08-03 and currently `latest`. Agent-native onboarding and a native MCP
server, a corpus-health command, the removal of built-in connectors, plus security, quality, and
supply-chain fixes.

### Removed

- **BREAKING: built-in connectors** (Granola / Obsidian / filesystem sync) and
  the `/v1/connectors` surface. Ingestion is not the engine's job — the wiki is
  plain markdown; your agent (or you) writes markdown into `content/`. Managed
  connectors are a Pro concern. (#8, #11)
- **`PUT /v1/config`** — a config-write path abusable as a remote-code-execution
  vector. `GET /v1/config` remains (read-gated); edit `remember.config.ts` and
  restart to change config. (#8, #11)

### Added

- **`remember mcp`** — a native Model Context Protocol server (stdio) so Claude
  Desktop/Code, Cursor, and any MCP client drive the wiki as native tools
  (`search_wiki` / `get_page` / `list_pages` / `write_page`), sharing the
  CLI/HTTP tool definitions, projection, honesty contract, and engine wiring.
  (#9, #10)
- **`remember setup`** — a one-command onboarding wizard (scaffold, install,
  index, and a "give this to your agent" trigger snippet). (#5–#7)
- **`remember doctor`** — deterministic corpus-health checks with `--json` /
  `--strict` and `GET /v1/doctor`; no LLM, no network. (#4)

### Changed

- **Embedder-aware chunking** — chunk size is capped to the embedder's real input
  limit (bge-small = 512 tokens) instead of a fixed 900, so chunks are no longer
  truncated at embed time; paired with a `heading_path` parser fix that
  repopulates heading breadcrumbs and re-enables heading-boost. CI retrieval gate
  re-baselined. (#12)
- **`@huggingface/transformers` is now an optional _peer_ dependency** — a bare
  `npm install @useremember/core` is lean and audit-clean (no transitive `sharp`
  CVEs); the local embedder is opt-in, the scaffold installs it, and the engine
  falls back to the placeholder hash embedder with a loud warning if absent. (#14)
- **Faster `remember dev`** — per-file watcher reindex (was whole-corpus),
  single embedding-model load at startup, batched result-frontmatter lookup. (#13)

### Security

- Data-loss / robustness fixes: guard recursive folder-delete against an empty
  path, reconcile the vector table on an embedder-dimension change, clean up
  ghost page rows on delete, and make a malformed-YAML file non-fatal to an index
  run (skipped + reported). (#4)

### Fixed

- CLI bad-invocation errors carry a stable `code: 'USAGE'` in `--json` output
  (was a blanket `COMMAND_ERROR`). (#13)
- Packaging: stale `./walkers/chokidar` export corrected to `./walkers/fs-walker`
  (the walker is a plain `fs` walk); `prebuild` clean so stale files never ship;
  version synced across `package.json` / `version.ts` / a test guard. (#13, #14)

## [0.2.4] - 2026-07-31

Reliability + supply chain.

### Added

- **Dependency-security gate** — a production dependency audit now runs in CI;
  resolved transitive security updates are pinned through the workspace lockfile.

### Fixed

- **Retryable local-model startup** — a transient first-download failure is no
  longer cached for the process lifetime; a later index or search retries with an
  actionable error instead of requiring a restart.

## [0.2.3] - 2026-07-28

Agent-DX and perceived-quality polish. No ranking changes — snippet *selection*
improves (displayed text only), a discovery surface is added, and Pro-roadmap
docs are removed from the public repo.

### Added

- **`remember capabilities` + `GET /v1/capabilities`.** One stable discovery
  object — `{ version, engine, embedder, endpoints, commands, json_schema_version }`
  — so an agent learns how to drive remember in a single call instead of
  stitching together `status`, `tools`, and `health`. Both surfaces share one
  source of truth (`capabilities.ts`); the shape is versioned by
  `json_schema_version` and locked by tests. Documented in `remember help
  agents` and the README agent guide. (`capabilities.ts`,
  `cli/commands/capabilities-cmd.ts`, `api/routes.ts`)

### Improved

- **Snippet selection for over-long, unpunctuated spans (presentation only).**
  When the best-matching chunk is a single span longer than the snippet cap — a
  table, a bullet list, or a run-on note with no sentence boundaries to split
  on — the snippet now slides a character-level window onto the query terms
  instead of returning the chunk head. Previously such a snippet showed the head
  (and the card's 240-char clamp then cropped the matched terms out entirely).
  This changes the **displayed snippet text only**: `score`, ranking, result
  order, and `chunk_id` are byte-identical before/after (verified on a
  vector-only query). Ordinary prose snippets are unchanged — the new path is
  unreachable unless a single selected sentence already exceeds the cap.
  (`search/snippet.ts`)

### Removed / Docs

- **Removed Pro-roadmap docs from the public repo (opsec).** Deleted
  `docs/plans/2026-07-23-viewer-productization.md` and `docs/superpowers/`
  (they described the Pro viewer/Cloud roadmap and a two-package
  `localhost:4321` model that contradicts the shipped CLI+API engine). Fixed the
  dangling reference at `docs/architecture.md` (now points to
  `retrieval-intelligence.md`) and dropped the unused `NOT_IMPLEMENTED` helper
  that cited the deleted spec dir. Also refreshed the sample-wiki onboarding
  pages (`getting-started.md`, `README.md`, `folder-organization.md`) and
  `examples/README.md`, which still described a browser viewer / admin panel at
  `localhost:4321` — now CLI + API only, matching 0.2.x reality.

## [0.2.2] - 2026-07-28

A first-run and onboarding polish pass. No behavior or ranking changes — only
CLI/DX surface and docs.

### Fixed

- **No more phantom "downloading ~100 MB" banner on cached runs.** transformers.js
  v3 fires progress events even when the embedding model is read from the local
  cache, so every `remember search` / `status` / `list` printed a scary
  `downloading embedding model … (first run only, ~100 MB)…` banner plus
  per-file progress — even offline, on a ~0.3s no-op. The announcement is now
  deferred behind a short timer: a warm-cache load resolves first and stays
  silent, while a genuine first-run download still shows the banner and streams
  progress. (`embedders/local-onnx.ts`)

### Changed

- **`remember search` footer** now points to `remember get <path>` (server-free,
  matches the agent `search → get` loop) instead of a hardcoded
  `curl http://localhost:4320/v1/pages/<path>` that assumed a running server.

### Docs

- **`@useremember/core` README (npm-facing)** refreshed: the CLI list now
  includes `search`, `list`, `get`, and `tools`; the Status section reads
  v0.2.x / CLI + API only (was a stale "v0.1.0 … and the viewer are
  implemented", which contradicted the CLI-only reality); the design-spec link
  now points to the public architecture overview.
- **Root README** — the CLI reference and the "What it does" table now list the
  `list`, `get`, and `tools` commands (previously omitted despite being the
  agent-facing surface).
- Removed 1.6 MB of orphaned browser-viewer screenshots from `docs/images/`
  (unreferenced by any doc; the viewer is a Pro feature outside this repo).

## [0.2.1] - 2026-07-27

Makes the CLI a first-class tool for **both humans and AI agents**, plus three
targeted fixes. Everything here is CLI/API surface and general engine hygiene.

### Added

- **`remember list`** — list indexed documents from the terminal. Aligned table
  (title, path, size, last-indexed) for humans; `--json` for agents. Flags:
  `--limit <n>` (alias `-n`), `--sort <path|title|size|modified|last_indexed>`
  (prefix `-` for descending). Reads the local index directly — no server.
- **`remember get <path>`** — fetch one document's frontmatter + markdown body
  by its content-relative path. `--json` returns
  `{ path, title, frontmatter, body, size, last_modified }`. This is the second
  half of the agent loop: `search --json` → pick a path → `get --json`.
- **`remember tools`** — print the Anthropic/OpenAI-shaped agent tool
  definitions (`search_wiki`, `get_page`, `list_pages`) — the exact defs the API
  serves at `GET /v1/tools`, now sourced from one shared module — so you can
  wire an LLM to remember without a running server. `--json` emits the raw defs.
- **`remember status --json`** — the status dashboard as a stable machine shape.
- **`remember help agents`** — a short "Using remember from an agent" guide: the
  `search → get` loop, the `--json` shapes, exit-code/error contract, and
  `remember tools`.
- **First-class agent contract:** every read command (`search`, `get`, `list`,
  `status`) speaks `--json` with **stable, documented, test-locked shapes**,
  exits `0` on success / non-zero on error, and emits
  `{ "error": { "code", "message" } }` on **stderr** when a `--json` command
  fails — so agents can script against it. Auto-plain (no color) when piped.
- `remember benchmark --rrf-k <n>` — override RRF fusion `k` for reproducible
  before/after fusion sweeps from the committed CLI.

### Changed

- **RRF fusion `k` default: 60 → 10.** At these candidate scales the
  `1/(k+rank)` curve is nearly flat by k=60, so a smaller k keeps more of the
  rank signal. Measured on the **OSS engine as shipped** (committed `benchmark`,
  fast/local-BGE profile, bundled sample-wiki): recall@1 0.640 → 0.660,
  MRR 0.980 → 1.000, nDCG@5/10 0.961 → 0.980, wrong-source 0.200 → 0.167;
  recall@5/10 already saturated at 0.980; latency unchanged. Better or equal on
  every metric, worse on none. Artifacts + note in `benchmarks/results/`.
- Single-sourced version bumped to `0.2.1` (CLI, HTTP API `/v1/health`, OpenAPI).

### Fixed

- **Global install (`npm i -g @useremember/core`) now "just works" in a
  scaffolded wiki.** The generated `remember.config.ts` imports
  `@useremember/core`; when the project never ran a local `npm install`, jiti
  (config loader) couldn't resolve that bare specifier from the project dir and
  `dev`/`index`/`search`/`list`/`status` failed. Config loading now resolves
  `@useremember/core` from the installed CLI's own location, and a genuine
  resolution failure produces a crystal-clear, actionable error
  (`npm install`, or `npm install -g @useremember/core`).

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
