# @remember/viewer

Browser viewer for [`remember`](../../README.md). Astro 5 + SSR.

## Routes

| Route | Purpose |
|---|---|
| `/` | Landing — renders `content/README.md` + lists all pages |
| `/[...slug]` | Render any markdown page by path (`.md` extension stripped) |
| `/search?q=...` | Server-rendered search UI hitting core's `/v1/search` |

## Dev

```bash
# Terminal 1 — start the core API
cd ../core && pnpm dev   # or: remember dev from a wiki folder

# Terminal 2 — start the viewer
pnpm --filter @remember/viewer dev
```

Viewer defaults to `http://127.0.0.1:4321` and talks to the core at `REMEMBER_API` (default `http://127.0.0.1:4320/v1`).

## v1.1+ roadmap

- `/admin/setup` — first-run config wizard
- `/admin/settings` — edit `remember.config.ts` via the UI
- `/admin/index` — reindex button + live status via SSE
- `/admin/diagnostics` — health, model info, debug toggles
- Structural folder/page operations (move, rename, delete) from the page tree
- Branding + theme config (CSS variable hooks already reserved in `Layout.astro`)
