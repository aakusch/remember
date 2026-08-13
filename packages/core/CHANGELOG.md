# Changelog — @useremember/core

## 0.3.1 — 2026-08-13 (security patch)

**Recommended upgrade for anyone on 0.3.0.** Two fixes found by an audit of the
Pro engine's path containment, plus recovery guidance for a damaged index.

- **Security — a dangling or looping symlink under `content/` no longer escapes
  the content root.** `safeJoinContent` resolved symlinks for real but walked
  past any component it could not resolve, and `realpathSync` throws the same
  `ENOENT` for "this path does not exist yet" (legitimate — every page write
  creates one) and for "this path is a symlink pointing nowhere". The second
  case walked up to the parent, declared it contained, and allowed the
  operation — and `fs.writeFile` follows the link, so
  `ln -s /etc/cron.d/x content/note.md` made `PUT /v1/pages/note.md` a write
  outside `content/`. An `ELOOP` cycle behaved the same. `lstatSync` now
  distinguishes the cases without following the link, so an unresolvable symlink
  fails closed. Guarded by `tests/path-utils-symlink.test.ts` against real
  inodes — the existing `path-utils.test.ts` uses a content root that does not
  exist on disk, so its `realpathSync` returned early and never reached this
  code at all.
- **Security — the agent trigger snippet no longer hands out the admin token.**
  It told the agent to stage pages via `PUT http://localhost:4320/v1/pages/<path>`
  "+ the admin token", putting the credential that gates every write into a file
  the agent reads on every prompt, and advertising a write authority the engine
  keeps off the default agent surface. It now leads with the MCP tools
  (`search_wiki` / `get_page`), falls back to the CLI, and stages through the
  filesystem, which is canonical anyway.
- **A damaged `.remember/index.db` now tells you how to recover.** Every command
  surfaced the raw better-sqlite3 string ("file is not a database") with no next
  step. The index is derived from `content/`, so deleting it is lossless — the
  CLI now says so, in both the human and `--json` error forms. Same treatment for
  schema mismatch, read-only, and locked-database failures.
- **New durability tests** (`tests/index-durability.test.ts`) characterizing an
  interrupted index (resumes by hash rather than restarting), a corrupt database
  (errors rather than reporting an empty corpus), and concurrent readers during a
  write. All three were exercised by hand against a real 496-document vault
  first.
- **CI now runs Windows** (Node 20), informationally. The CLI carries two native
  modules plus an optional ONNX runtime and had never been tested there.

## 0.3.0 — 2026-08-02 (MCP, onboarding, doctor, connector removal)

Published to npm 2026-08-03 and currently `latest`. The pre-launch release:
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
- **Security — a dangling or looping symlink in `content/` no longer escapes the
  content root.** `safeJoinContent` resolved symlinks for real, but walked past a
  component it could not resolve: `realpathSync` throws the same `ENOENT` for "this
  path does not exist yet" (legitimate — every page write creates one) and for
  "this path is a symlink pointing nowhere". The second case walked up to the
  parent, declared it contained, and allowed the write — and `fs.writeFile`
  follows the link, so `ln -s /etc/cron.d/x content/note.md` made
  `PUT /v1/pages/note.md` a write outside `content/`. An `ELOOP` cycle behaved the
  same. `lstatSync` now distinguishes the cases without following the link, so an
  unresolvable symlink fails closed. Found by the Pro engine's `resolveContentPath`
  audit; guarded by `tests/path-utils-symlink.test.ts`, which exercises real
  inodes (the existing `path-utils.test.ts` uses a content root that does not
  exist, so its `realpathSync` returns early and it never reached this code).
- **Security — the agent trigger snippet no longer hands out the admin token.** It
  told the agent to stage pages via `PUT http://localhost:4320/v1/pages/<path>`
  "+ the admin token", putting the credential that gates every write into a file
  the agent reads on every prompt, and advertising a write authority the engine
  keeps off the default agent surface. It now leads with the MCP tools
  (`search_wiki` / `get_page`), falls back to the CLI, and stages through the
  filesystem, which is canonical anyway.
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
