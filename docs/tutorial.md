# Tutorial

A hands-on walkthrough that takes about 15 minutes. By the end you'll have a working wiki, indexed content, external content brought in as markdown, and an AI agent answering questions against it — all from the terminal and the HTTP API.

> **Prerequisites:** Node 20+, npm (pnpm 9+ / yarn work too), and a terminal.
>
> The open-source engine is **CLI + API only** — there is no browser UI. (The browser viewer/editor is a **Pro** feature.)

## 1. Install

```bash
npx @useremember/core init my-wiki
cd my-wiki
npm install    # pnpm / yarn work too
npm run dev
```

`npm run dev` indexes the starter wiki and serves the agent HTTP API on `:4320`
with a live file watcher. The first index downloads the local ONNX embedding
model (`BAAI/bge-small-en-v1.5`, ~100 MB) via the optional
`@huggingface/transformers` dependency and caches it — subsequent runs are
offline. If that dependency is missing you'll see a loud placeholder-embedder
warning; install it with `npm install @huggingface/transformers` or set
`OPENAI_API_KEY`.

Confirm it's up from another terminal:

```bash
remember status                        # index dashboard: pages, chunks, model
remember search "getting started" -k 5 # ranked result cards
curl http://localhost:4320/v1/health   # → {"ok":true,"version":"0.2.6"}
```

> `remember` lives in the project's `node_modules/.bin`. Prefix the commands
> below with `npx --no-install` (or `pnpm exec`) — e.g.
> `npx --no-install remember status` — unless you installed it globally with
> `npm i -g @useremember/core`. Avoid a plain `npx remember` outside the
> project directory: it fetches an unrelated npm package named `remember`.

The starter wiki ships with three pages (`getting-started`, `agents`, `authoring`).

## 2. Add a page

Drop any `.md` file into `content/`:

```bash
cat > content/deploy-runbook.md <<'MD'
---
title: Deploy runbook
tags: [runbook, ops]
owner: platform
severity: medium
status: stable
---

# Deploy runbook

When you need to ship to production safely.

## Pre-flight

- CI green on the feature branch
- At least one approving review
- No active incident on the #incidents channel

## Steps

1. Merge to main
2. Tag with `git tag v$(date +%Y.%m.%d).$(git rev-list --count HEAD)`
3. Watch the canary
4. Promote to full when canary is clean for 10 minutes
MD
```

The filesystem watcher catches the new file within about a second and reindexes
it incrementally. Confirm it landed:

```bash
remember search "deploy runbook" -k 3
```

## 3. Search it

Two patterns:

**CLI** — ranked result cards straight in your terminal:

```bash
remember search "how do I deploy" -k 5
# add --json for clean machine output, or --open to open the top hit in $EDITOR
```

**HTTP API** — for AI agents, scripts, anything that speaks JSON:

```bash
curl 'http://localhost:4320/v1/search?q=how+do+I+deploy&k=5&debug=1'
```

```json
{
  "query": "how do I deploy",
  "results": [
    {
      "path": "deploy-runbook.md",
      "snippet": "Deploy runbookWhen you need to ship to production safely…",
      "score": 0.0328,
      "retrievers": ["bm25", "vector"],
      "frontmatter": {
        "title": "Deploy runbook",
        "tags": ["runbook", "ops"],
        "owner": "platform",
        "severity": "medium"
      }
    }
  ],
  "query_ms": 3,
  "debug": {
    "bm25_ms": 1,
    "bm25_count": 1,
    "embed_ms": 2,
    "vector_ms": 0,
    "vector_count": 3,
    "fuse_ms": 0,
    "rerank_ms": 0
  }
}
```

`?debug=1` shows the structured ranking trace, including retriever candidate
counts, RRF contributions, metadata signals, fallbacks, and per-stage timings.

**AI tool definitions** — for Claude, GPT, or anything that takes Anthropic/OpenAI-shaped tool definitions:

```bash
curl http://localhost:4320/v1/tools
```

Drop the response into your LLM's tool-use call. Three tools: `search_wiki`, `get_page`, `list_pages`.
Prefer native MCP? `remember mcp` serves the same tools (plus `write_page`) to any MCP client over stdio.

## 4. Edit your pages

Your wiki is plain markdown in `content/` — edit it in any editor (VS Code,
Obsidian, `vim`) and the filesystem watcher reindexes changed files within a
second. Nothing else to learn.

Agents and scripts can also write through the API. `PUT /v1/pages/<path>` takes
a JSON body — `{ "body": "<full markdown, including frontmatter>" }`:

```bash
# Write (or overwrite) a page and reindex it
curl -X PUT 'http://localhost:4320/v1/pages/notes/scratch.md' \
  -H 'Content-Type: application/json' \
  -d '{"body": "---\ntitle: Scratch\n---\n\n# Scratch\n\nSome notes.\n"}'

# Move/rename, or delete
curl -X POST 'http://localhost:4320/v1/pages/move' \
  -H 'Content-Type: application/json' \
  -d '{"from":"notes/scratch.md","to":"notes/kept.md"}'
curl -X DELETE 'http://localhost:4320/v1/pages/notes/kept.md'
```

Two rules to remember:

- **POST and PUT require `Content-Type: application/json`** (a cross-site
  request guard) — a raw markdown body with a non-JSON content type is
  rejected, and so is curl's default form encoding, so always pass the header.
- **Page paths keep their real slashes** — `GET /v1/pages/ops/deploy.md`, with
  the `/` separators literal. Percent-encoding them 404s.

Writes from a non-loopback origin require `REMEMBER_ADMIN_TOKEN`
(`Authorization: Bearer <token>`).

## 5. Configure

Configuration lives in `remember.config.ts`, a typed file you edit directly.
Every field has a default, so change only what you need. A few useful knobs:

- **Lighter embedding model** — `defaults.embedder.localOnnx({ model: 'mixedbread-ai/mxbai-embed-xsmall-v1' })` for low-RAM machines.
- **OpenAI embeddings** — set `OPENAI_API_KEY` (the embedder switches automatically).
- **Remote access** — set `server.host` to `0.0.0.0` and provide an admin token (see [step 9](#9-run-in-production)).

Restart `remember start` (or `remember dev`) to pick up config changes.
`GET /v1/config` returns the loaded config (read-gated); config is written only
on disk — there is no config-write HTTP endpoint.

## 6. Query by frontmatter

Frontmatter is stored and queryable through `GET /v1/pages` — filter, sort, and
page over your whole corpus:

```bash
curl 'http://localhost:4320/v1/pages?filter[tags]=runbook'
curl 'http://localhost:4320/v1/pages?filter[owner]=platform&sort=severity'
curl 'http://localhost:4320/v1/pages?filter[status]=stable&sort=-modified&limit=20'
```

Filter rules AND together. Sort by any system column (`path`, `modified`,
`title`, `size`, `last_indexed`) or any frontmatter key (use `-key` for
descending). `GET /v1/attrs` lists the distinct frontmatter keys available to
filter on. An agent uses exactly these endpoints to narrow before it reads.

## 7. Bring in external content

`remember` ships **no built-in connectors** on purpose — your agent is the
connector. To pull in an external source (meeting notes, another tool's vault,
an export), your AI agent (or you) fetches it, converts it to markdown, and
writes it into `content/`. Two ways to land it:

**Write a file** — the watcher indexes it within a second:

```bash
cat > content/external/weekly-sync.md <<'MD'
---
title: Weekly sync — 2026-08-01
tags: [meeting]
---

# Weekly sync

Decisions and action items from the call…
MD
```

**Or over HTTP** — `PUT /v1/pages/<path>` with a JSON body and the admin token:

```bash
curl -X PUT 'http://localhost:4320/v1/pages/external/weekly-sync.md' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $REMEMBER_ADMIN_TOKEN" \
  -d '{"body": "---\ntitle: Weekly sync — 2026-08-01\ntags: [meeting]\n---\n\n# Weekly sync\n\nDecisions and action items…"}'
```

Either way it's plain markdown in `content/` — searchable in about a second and
yours to edit like any other page. Managed, turnkey connectors are a **Pro**
concern, not part of this engine.

## 8. Plug in an AI agent

The drop-in pattern with Claude, using the Anthropic SDK:

```ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// Fetch the tool definitions from your wiki
const toolsRes = await fetch('http://localhost:4320/v1/tools');
const { tools } = await toolsRes.json();

// Use them in a tool-use call
const message = await client.messages.create({
  model: 'claude-sonnet-4-5',
  max_tokens: 1024,
  tools,
  messages: [
    { role: 'user', content: 'How do we roll back a bad deploy?' },
  ],
});

// When Claude calls search_wiki or get_page, you fetch the corresponding endpoint:
for (const block of message.content) {
  if (block.type === 'tool_use') {
    let result;
    if (block.name === 'search_wiki') {
      const r = await fetch(`http://localhost:4320/v1/search?q=${encodeURIComponent(block.input.query)}&k=${block.input.k ?? 5}`);
      result = await r.json();
    } else if (block.name === 'get_page') {
      // Keep the / separators literal — percent-encoding them 404s.
      const pagePath = block.input.path.split('/').map(encodeURIComponent).join('/');
      const r = await fetch(`http://localhost:4320/v1/pages/${pagePath}?format=text`);
      result = await r.text();
    } else if (block.name === 'list_pages') {
      const r = await fetch(`http://localhost:4320/v1/pages?limit=${block.input.limit ?? 50}`);
      result = await r.json();
    }
    // Continue the conversation with the tool result...
  }
}
```

No special integration on the wiki side — `remember` is just an HTTP server, and the tool definitions are auto-generated. For clients that speak MCP, `remember mcp` exposes the same tools over stdio with no HTTP server at all.

## 9. Run in production

Same `remember start` command, but under a process manager or in Docker:

**With Docker** (recommended):

```bash
export REMEMBER_ADMIN_TOKEN=$(openssl rand -hex 32)
docker compose up -d
```

The compose file binds `127.0.0.1` on the host by default. Edit it to expose more broadly when you want — the admin token gates remote reads + all mutations.

**With systemd / pm2**:

```bash
export REMEMBER_HOST=0.0.0.0
export REMEMBER_ADMIN_TOKEN=$(openssl rand -hex 32)
remember start
```

The server refuses non-loopback binds without `REMEMBER_ADMIN_TOKEN` set, and the token now gates remote reads too (introduced in v0.0.1 wave 5).

## What you've built

After this tutorial you have:

- A running agent API at `http://localhost:4320`
- 4 pages indexed (3 starter + your `deploy-runbook.md`)
- Hybrid search returning results from both BM25 and vector retrievers, from the CLI and over HTTP
- A hand-edited `remember.config.ts`
- Frontmatter queries over `/v1/pages` for any filter/sort you need
- External content pulled into the same index as plain markdown
- An AI agent that can search and read pages via `/v1/tools`

## Next

- [Architecture overview](./architecture.md) — pipeline, adapters, performance numbers, the v2-cloud sketch
- [`examples/sample-wiki/`](../examples/sample-wiki/) — 25-page reference wiki used in development
- [`CHANGELOG.md`](../CHANGELOG.md) — wave-by-wave history of what shipped
- [Issue tracker](https://github.com/aakusch/remember/issues) — questions, bugs, feature requests
