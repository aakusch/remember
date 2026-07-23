# @useremember/viewer

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
pnpm --filter @useremember/viewer dev
```

Viewer defaults to `http://127.0.0.1:4321` and talks to the core at `REMEMBER_API` (default `http://127.0.0.1:4320/v1`).

## Productization roadmap

The current routes are functional but remain a developer-oriented viewer and
administration surface. Future UI work follows the
[consumer viewer productization plan](../../docs/plans/2026-07-23-viewer-productization.md):

- one responsive information architecture centered on Home, Search, Library,
  Sources, and Settings;
- guided setup that does not require configuration-file or terminal work for
  supported paths;
- a reusable component and token system instead of route-local controls and
  styles;
- simple defaults with contextual access to Search traces, raw configuration,
  diagnostics, index operations, and APIs; and
- mobile, accessibility, end-to-end, visual-regression, and observed-usability
  release gates.

Do not add another route-specific button, card, form, status, or dialog pattern
when the productization phase has established its shared equivalent.
