# @remember/viewer

Browser viewer + admin UI for [`remember`](../../README.md).

## Stack

- **Astro** — static markdown rendering + page routing
- **React islands** — interactive admin (setup wizard, settings, reindex controls, folder ops)
- Talks to [`@remember/core`](../core) over HTTP / JSON / SSE

## Routes (planned)

| Route | Purpose |
|---|---|
| `/` | Configured landing page (default `README.md`) |
| `/[...slug]` | Render any markdown page |
| `/search` | Semantic search UI |
| `/admin/setup` | First-run wizard |
| `/admin/settings` | Edit `remember.config.ts` via UI |
| `/admin/index` | Reindex button + live status |
| `/admin/diagnostics` | Health, model info, debug toggles |

Admin routes are localhost-only by default; `REMEMBER_ADMIN_TOKEN` enables remote admin.

## Status

**Scaffold placeholder.** The Astro project will be initialized via `npm create astro@latest` during the implementation phase so we pick up the current template.

Until then, this directory exists to reserve the package name and validate the monorepo wiring.
