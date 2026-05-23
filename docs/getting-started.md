# Getting started with `remember`

This walks you from zero to a working local AI-ready wiki in about 60 seconds, then gives you a tour of the surface area.

## TL;DR

```bash
npx @remember/cli init my-wiki
cd my-wiki
pnpm install
pnpm dev
# → http://localhost:4321
```

That's it. The viewer opens at `:4321`, the API at `:4320`, and a small starter wiki is already indexed.

## What `init` gives you

```
my-wiki/
  content/                       ← markdown — the canonical source
    README.md                    ← landing page (configurable)
    getting-started.md           ← short orientation page
    examples/
      with-frontmatter.md        ← shows how frontmatter drives table view
      with-wikilinks.md          ← (optional, if you set up an Obsidian connector)
  remember.config.ts             ← typed config — connectors, embedder, ports
  .gitignore                     ← skips .remember/ + node_modules
  .rememberignore                ← extends ignore rules for indexing
  package.json                   ← scripts: dev, start, index, status
```

`content/` is where you write. Everything else is generated or config.

## The five things to know

### 1. Pages are markdown files

Drop `.md` files into `content/`. They get parsed, chunked, embedded, and indexed automatically. Watcher picks up changes in <1 second.

Frontmatter is fully supported:

```markdown
---
title: Database restore runbook
tags: [runbook, ops]
owner: platform
severity: high
status: tested
---

# Database restore runbook
...
```

The viewer renders tags as badges, the table view filters/sorts by any frontmatter key, and AI search includes frontmatter context.

### 2. Search is hybrid by default

- **BM25** for keyword matches (via sqlite FTS5)
- **Vector** for semantic matches (via sqlite-vec + a local ONNX embedding model)
- **Reciprocal Rank Fusion** to combine them

You don't have to think about which mode to use — the engine fuses them.

Try it:

```bash
curl 'http://localhost:4320/v1/search?q=how+do+I+rollback&k=5&debug=1' | jq .
```

`debug=1` shows per-stage timings + which retriever surfaced each hit.

### 3. AI plugs in via `/v1/tools`

The core API exposes Anthropic/OpenAI-compatible tool definitions:

```bash
curl http://localhost:4320/v1/tools
```

Drop the response straight into a Claude or GPT tool-use call. Three tools:
- `search_wiki` — hybrid search, returns ranked chunks
- `get_page` — fetch one page by path
- `list_pages` — paginated list

This is the "AI plugs in" promise made real.

### 4. The viewer is also an editor

Open any page → click ✎ Edit. Markdown source on the left, live preview on the right. Type `/` at the start of a line for the slash-command palette (16 commands: `/h1`, `/code`, `/table`, `/mermaid`, etc.). `Cmd/Ctrl+S` saves and reindexes.

External edits work too — `remember` watches the filesystem. Edit a file in VS Code or Obsidian, save, the open viewer tab refreshes automatically.

### 5. Connectors pull external sources

Configure them in `remember.config.ts`:

```ts
import { defineConfig, defaults } from '@remember/core';

export default defineConfig({
  connectors: [
    defaults.connector.obsidian({
      vaultPath: '~/Documents/Obsidian Vault',
      transformWikilinks: true,
      tag: 'obsidian',
    }),
    defaults.connector.granola({
      apiUrl: process.env.GRANOLA_API_URL,
      apiKey: process.env.GRANOLA_API_KEY,
      tag: 'meeting',
    }),
  ],
});
```

Synced files land in `content/external/<connector>/` and get indexed normally. Manage them at [http://localhost:4321/admin/connectors](http://localhost:4321/admin/connectors).

## Setup wizard

[http://localhost:4321/admin/setup](http://localhost:4321/admin/setup) walks you through every config knob with presets, a model dropdown, and a "CHANGED" pill on each field that differs from your current config. Click **Save to disk** to write `remember.config.ts` directly (with a timestamped `.bak` backup).

Four presets to start from:
- **Local quickstart** — default `bge-small-en-v1.5`, localhost-only, no token
- **Lightweight local** — smaller `mxbai-embed-xsmall-v1` (~30MB) for constrained machines
- **OpenAI-powered** — flips to OpenAI embeddings
- **Team / remote access** — host `0.0.0.0`, auto-generated 32-hex admin token

## Common admin actions

| What | Where |
|---|---|
| First-run config | [`/admin/setup`](http://localhost:4321/admin/setup) |
| Trigger reindex | [`/admin/reindex`](http://localhost:4321/admin/reindex) |
| Browse / move / delete files | [`/admin/files`](http://localhost:4321/admin/files) |
| Filter/sort frontmatter as a table | [`/admin/views`](http://localhost:4321/admin/views) |
| Manage connectors | [`/admin/connectors`](http://localhost:4321/admin/connectors) |
| View loaded config | [`/admin/settings`](http://localhost:4321/admin/settings) |
| Health + OpenAPI + tool defs | [`/admin/diagnostics`](http://localhost:4321/admin/diagnostics) |

## Going to production

For now: same `remember start` command, just run it under a process manager (`pm2`, `systemd`, or `docker compose`). Set:

```bash
export REMEMBER_HOST=0.0.0.0
export REMEMBER_ADMIN_TOKEN=$(openssl rand -hex 32)
remember start
```

The server refuses non-loopback binds without `REMEMBER_ADMIN_TOKEN` set, and the token now gates remote reads too (not just mutations).

Docker:

```bash
docker compose up -d
```

See [`docker-compose.yml`](../docker-compose.yml) for the full configuration including volume mounts.

## Configuration reference

The full schema is in [`packages/core/src/config/schema.ts`](../packages/core/src/config/schema.ts). Every field has a sensible default — `defineConfig({})` is valid.

ENV overrides (take precedence over config):

| ENV var | Maps to |
|---|---|
| `REMEMBER_CONTENT` | `content` directory |
| `REMEMBER_HOST` | `server.host` |
| `REMEMBER_PORT` | `server.port` (viewer) |
| `REMEMBER_API_PORT` | `server.apiPort` |
| `REMEMBER_ADMIN_TOKEN` | `server.adminToken` |
| `REMEMBER_EMBED_MODEL` | embedder model override |
| `OPENAI_API_KEY` | opts the embedder into OpenAI |

## Next steps

- [Architecture overview](./architecture.md)
- [Connectors guide](./connectors.md)
- [v1 design spec](./superpowers/specs/2026-05-23-remember-platform-design.md) — the comprehensive spec that drove the build
- [CHANGELOG](../CHANGELOG.md) — what shipped when

Questions or stuck? Open a [Discussion](https://github.com/aakusch/remember/discussions) or file an [Issue](https://github.com/aakusch/remember/issues).
