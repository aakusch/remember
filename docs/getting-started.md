# Getting started with `remember`

This walks you from zero to a working local AI-ready wiki in about 60 seconds, then gives you a tour of the surface area.

## TL;DR

```bash
npx @useremember/core init my-wiki
cd my-wiki
pnpm install
pnpm dev
# → agent API on http://localhost:4320
```

That's it. `pnpm dev` indexes the starter wiki and serves the agent HTTP API on
`:4320` with a live file watcher. Search it from another terminal:

```bash
remember search "getting started" -k 5
```

The open-source engine is **CLI + API only** — there is no browser UI. (The
browser viewer/editor is a **Pro** feature; see [below](#what-the-pro-engine-adds).)
Local semantic search uses the optional `@huggingface/transformers` dependency,
which the scaffold installs for you; the embedding model (~100 MB) downloads
once on first index and is cached. If it's missing, `remember` prints a loud
placeholder-embedder warning — install it with `npm install @huggingface/transformers`
or set `OPENAI_API_KEY`.

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

Frontmatter is parsed, stored, and returned in every search result — an agent can read it off a result and filter on it (e.g. `GET /v1/pages?filter[status]=current`). Search also folds frontmatter into the indexed context.

### 2. Search is hybrid by default

- **BM25** for keyword matches (via sqlite FTS5)
- **Vector** for semantic matches (via sqlite-vec + a local ONNX embedding model)
- **Reciprocal Rank Fusion** to combine them

You don't have to think about which mode to use — the engine fuses them.

Try it:

```bash
curl 'http://localhost:4320/v1/search?q=how+do+I+rollback&k=5&debug=1' | jq .
```

`debug=1` shows the structured ranking trace: candidate counts, RRF
contributions, metadata signals, result IDs, fallbacks, and per-stage timings.

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

**The honesty contract:** a returned result means the corpus contains text that
ranked for the query — it is *not* proof that an answer exists. If the right
document isn't indexed, the engine still returns its closest matches. Treat
results as candidates to read, not as guaranteed answers.

### 4. Editing is just files (plus a write API)

Your wiki is plain markdown in a directory. Edit it however you like — VS Code,
Obsidian, `vim` — and the filesystem watcher reindexes changed files within a
second. No editor UI ships with the open-source engine.

Agents and scripts can also write through the API: `PUT /v1/pages/<path>` writes
markdown and reindexes, `DELETE /v1/pages/<path>` removes and reconciles, and
`POST /v1/pages/move` renames. Writes from a non-loopback origin require
`REMEMBER_ADMIN_TOKEN`.

### 5. Connectors pull external sources

Configure them in `remember.config.ts`:

```ts
import { defineConfig, defaults } from '@useremember/core';

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

Synced files land in `content/external/<connector>/` and get indexed normally.
The connector manager runs an initial sync on boot; trigger a resync at any time
with `POST /v1/connectors/<name>/sync` (or `POST /v1/connectors/sync` for all)
and check status with `GET /v1/connectors`.

## Configuration

Configuration lives in `remember.config.ts` — a typed file you edit directly.
Every field has a sensible default, so `defineConfig({})` is valid; override only
what you need. Common changes:

- **Switch to a lighter embedding model** — `defaults.embedder.localOnnx({ model: 'mixedbread-ai/mxbai-embed-xsmall-v1' })` for constrained machines.
- **Use OpenAI embeddings** — set `OPENAI_API_KEY` (the embedder switches automatically) or pin `defaults.embedder.openai(...)`.
- **Remote access** — set `server.host` to `0.0.0.0` and provide an admin token (see [Going to production](#going-to-production)).

The API can also read and write config: `GET /v1/config` returns the loaded
config, `PUT /v1/config` writes it back with a timestamped `.bak` backup.

## Common actions over the API

| What | How |
|---|---|
| Trigger a reindex | `POST /v1/index` (or `remember index`) |
| Query / filter / sort by frontmatter | `GET /v1/pages?filter[k]=v&sort=-date` |
| Manage connectors | `GET/POST /v1/connectors...` |
| Read loaded config | `GET /v1/config` |
| Health, OpenAPI, tool defs | `GET /v1/health`, `/v1/openapi.json`, `/v1/tools` |
| Index stats dashboard | `remember status` |

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
| `REMEMBER_API_PORT` | `server.apiPort` (the agent HTTP API; default 4320) |
| `REMEMBER_ADMIN_TOKEN` | `server.adminToken` |
| `REMEMBER_EMBED_MODEL` | embedder model override |
| `OPENAI_API_KEY` | opts the embedder into OpenAI |

## What the Pro engine adds

This open-source engine is the retrieval core: CLI + agent API, hybrid
BM25 + vector search, local by default. **Pro** is a paid, self-hosted engine
built on the same core that adds a browser UI (viewer/editor), quality levers
(status-based demotion, HTML/DOCX ingestion, richer agent filters over
status/type/date), and an optional BYO-Postgres store for larger corpora. A
later hosted **Cloud** tier runs the Pro engine as a managed service. This
repository is the open-source core only.

## Next steps

- [Architecture overview](./architecture.md)
- [Tutorial](./tutorial.md) — a hands-on end-to-end walkthrough
- [CHANGELOG](../CHANGELOG.md) — what shipped when

Questions or stuck? Open a [Discussion](https://github.com/aakusch/remember/discussions) or file an [Issue](https://github.com/aakusch/remember/issues).
