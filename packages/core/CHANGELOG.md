# Changelog — @useremember/core

## 0.3.0 — 2026-08-02 (pre-launch: MCP, onboarding, doctor, connector removal)

Staged for publish (npm latest is still `0.2.6`). The pre-launch release:
agent-native onboarding and a native MCP server, a corpus-health command, the
removal of built-in connectors, and a batch of security, quality, and
supply-chain fixes.

- **BREAKING — built-in connectors removed** (Granola / Obsidian / filesystem
  sync, and the `/v1/connectors` surface). Ingestion is deliberately not the
  engine's job: the wiki is plain markdown, so your agent (or you) writes
  markdown into `content/`. Managed connectors are a Pro concern. (#8, #11)
- **New: `remember mcp`** — a native Model Context Protocol server (stdio) so
  Claude Desktop/Code, Cursor, and any MCP client drive the wiki as native tools
  (`search_wiki` / `get_page` / `list_pages` / `write_page`). Shares the CLI/HTTP
  tool definitions, result projection, honesty contract, and engine wiring — one
  surface, not a bolt-on. (#9, #10)
- **New: `remember setup`** — a one-command onboarding wizard: scaffold, install,
  index, and a printed "give this to your agent" trigger snippet. (#5–#7)
- **New: `remember doctor`** — deterministic corpus-health checks (not-indexed,
  unfindable, duplicate body/title, thin/structureless pages, missing
  frontmatter, …), `--json` / `--strict`, and `GET /v1/doctor`. No LLM, no
  network. (#4)
- **Embedder-aware chunking.** Chunk size is capped to the embedder's real input
  limit (bge-small = 512 tokens) instead of a fixed 900, so chunks are no longer
  silently truncated at embed time; paired with a `heading_path` parser fix that
  repopulates heading breadcrumbs and re-enables heading-boost. CI retrieval gate
  re-baselined. (#12)
- **`@huggingface/transformers` is now an optional _peer_ dependency**, so a bare
  `npm install @useremember/core` is lean and audit-clean (no transitive `sharp`
  CVEs). The local embedder is opt-in; the scaffold installs it for a real wiki,
  and the engine falls back to the placeholder hash embedder with a loud warning
  if it's absent. (#14)
- **Security — removed `PUT /v1/config`**, a config-write path abusable as a
  remote-code-execution vector. `GET /v1/config` remains (read-gated). Plus
  data-loss fixes: guard recursive folder-delete against an empty path, reconcile
  the vector table on an embedder-dimension change, clean up ghost page rows on
  delete, and make a malformed-YAML file non-fatal to an index run. (#4, #8, #11)
- **Faster `remember dev`** — the watcher reindexes only the changed file (was
  re-walking the whole corpus per save), the embedding model loads once at
  startup, and result frontmatter is fetched in one batched query. (#13)
- **CLI usage errors carry `code: 'USAGE'`** in `--json` output (was a blanket
  `COMMAND_ERROR`), so agents distinguish a bad invocation from a runtime
  failure. Packaging: fixed a stale `./walkers/chokidar` export → `fs-walker`, a
  `prebuild` clean so stale files never ship, and version synced across
  `package.json` / `version.ts` / a test guard. (#13, #14)

## 0.2.4 — 2026-07-31 (reliability + supply chain)

- **Retryable local-model startup.** A transient first-download failure no
  longer remains cached for the process lifetime; a later index or search
  retries without requiring a server restart, with an actionable error message.
- **Dependency-security gate.** Production dependency audit now runs in CI.
  Resolved transitive security updates are pinned through the workspace lockfile.

## 0.2.0 — 2026-07-27 (CLI-first)

**The open-source engine is now CLI + agent API only.** The browser UI has moved
to remember Pro — `@useremember/core` no longer ships or depends on a viewer, and
`@useremember/viewer` is deprecated. A scaffolded project drops from ~503 to ~189
installed packages (the entire Astro/Vite runtime is gone).

- **New: `remember search "<query>"`** — a first-class command with formatted
  result cards (rank, score, path, title, query-relevant snippet), `-k <n>`, and
  `--json` for clean machine output (stable shape: rank/score/path/title/snippet/
  heading_path/retrievers/chunk_id/frontmatter) so agents and scripts can consume
  it directly.
- **Rich, formatted CLI** across `init` / `dev` / `start` / `index` / `status` /
  `help` — aligned layout, restrained color (auto-disabled under `NO_COLOR` or
  when piped), a tidy `status` dashboard. No CLI framework; a few hand-rolled
  ANSI helpers.
- **`remember dev` is cleanly API-only** — no viewer spawn, no "install the
  viewer" hint, a compact startup block (API, health, search, pages, tools).
- **Better text extraction.** Block-level markdown elements (headings,
  paragraphs, list items) are now separated when flattened, so search snippets
  no longer run words together ("wiki**This**" → "wiki This"). *Upgrading an
  existing wiki:* run `rm -rf .remember && remember index` once — incremental
  indexing keys on file changes, so a code-only pipeline change isn't picked up
  automatically.
- **Model-download progress** is clean on both a terminal (one overwriting line)
  and a pipe (throttled updates, not hundreds of repeated lines).

Migration: remove `@useremember/viewer` from your project's dependencies; the
browser UI is a Pro feature. Everything else (config, content, API) is unchanged.

## 0.1.2 — 2026-07-27 (onboarding)

- **The browser viewer now works for npm users.** `@useremember/viewer` is
  published (0.1.2) and `remember dev` runs its built standalone server
  (`node dist/server/entry.mjs`) instead of spawning a heavyweight `astro dev`.
  `remember init` scaffolds the viewer as a dependency again, so a fresh wiki
  gets a working UI on `npm install`. When the viewer is absent, `remember dev`
  degrades cleanly to API-only with an accurate message (no more pointing users
  at an install command for an unpublished package).
- **Fixed the "embedding model ready" message printing once per downloaded
  file** (it fired on every file's `done` event — typically 4×). The download is
  announced once, progress streams on a single line, and "ready" prints once
  when the model finishes loading.
- **Cleaner, tighter CLI onboarding.** `remember init` next-steps and
  `remember dev` / `remember start` startup blocks are compact and scannable
  (API, health, search, tools, viewer URL), and honest about the viewer.
- **The viewer's admin UI authenticates automatically.** `remember dev` passes
  the configured admin token to the viewer, which forwards it as a bearer token
  on mutations — so reindex, config save, and file operations work in the
  browser even when an admin token is set. Fixed an admin-form regression where
  Astro's origin check rejected same-origin POSTs over http.
- **Version is single-sourced** in `src/version.ts` (was hardcoded in four
  places).
- **Security: bumped `hono` (→ 4.12.32) and `@hono/node-server` (→ 2.x)** to
  clear known advisories in the API server's dependencies.

## 0.1.1 — 2026-07-27 (security)

- **Security: `GET /v1/config` no longer returns the `adminToken` value.** The
  endpoint is read-gated, but it dumped the raw admin token — which authorizes
  writes and config replacement (`PUT /v1/config`) — to any read-authorized
  caller, including any local process on a loopback bind. The token value is now
  redacted from the payload; read access to the non-secret config is unchanged.
  Upgrade if you run `remember` with an `adminToken` set.

## 0.1.0

- Initial public release: local-first hybrid (BM25 + vector) retrieval engine
  and CLI over a folder of markdown, with an HTTP API for AI agents.
