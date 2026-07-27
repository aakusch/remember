# Changelog — @useremember/core

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
