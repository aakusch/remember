# Tutorial

A hands-on walkthrough that takes about 15 minutes. By the end you'll have a working wiki, indexed content, a custom view, a connector pulling external data, and an AI agent answering questions against it.

> **Prerequisites:** Node 20+, pnpm 9+ (or npm), and a terminal.

## 1. Install

```bash
npx @useremember/core init my-wiki
cd my-wiki
pnpm install
pnpm dev
```

The first `pnpm dev` will start both processes: the core API on `:4320` and the viewer on `:4321`. The first reindex downloads the local ONNX embedding model (~80 MB) to `~/.cache/huggingface/` — subsequent runs are fast.

Open **<http://localhost:4321>** in your browser. You should see the landing page with three pages already in the sidebar (`README`, `getting-started`, `examples/with-frontmatter`).

![Home page](./images/01-home.png)

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

The filesystem watcher catches the new file within ~500 ms. The viewer's open tabs auto-refresh via Server-Sent Events. Browse to **<http://localhost:4321/deploy-runbook>** to see it rendered with breadcrumbs, tag pills, TOC, and the Edit button.

![Page detail](./images/02-page-detail.png)

## 3. Search it

Three patterns:

**Browser** — search bar at the top of every page:

```
how do I deploy
```

![Search results](./images/03-search.png)

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

## 4. Edit in the browser

Click ✎ Edit on any page (or visit `/admin/edit/<path>`). The editor has source on the left, live preview on the right. Type `/` at the start of a line for the slash command palette — 20 commands including:

- `/h1` `/h2` `/h3` `/h4` — headings
- `/bullet` `/numbered` `/todo` — list types
- `/code` `/code-ts` `/code-py` `/code-sh` — code blocks (with language)
- `/quote` `/table` `/hr` — block elements
- `/link` `/image` — inline references
- `/math` `/mermaid` — diagrams
- `/frontmatter` — scaffolds a YAML block

![Editor with slash menu](./images/08-editor-slash.png)

Arrow keys navigate the list, Enter or Tab inserts, Escape closes. Type to filter (`/co` narrows to code blocks). The caret lands inside the inserted scaffold where you'll want to keep typing (`/code` drops you between the fence lines, `/link` drops you between the `()`).

**Save with `⌘/Ctrl+S`** — same as clicking Save.

## 5. Configure via the setup wizard

`/admin/setup` is an interactive `remember.config.ts` builder. It detects your loaded config, lets you tweak fields, and flags every changed field with a "CHANGED" pill so you can see exactly what's different from what's running.

![Setup wizard](./images/06-setup-wizard.png)

Four preset profiles to start from:

- **Local quickstart** — `BAAI/bge-small-en-v1.5`, localhost-only, no token
- **Lightweight local** — `mxbai-embed-xsmall-v1` (~30 MB) for low-RAM machines
- **OpenAI-powered** — flips to OpenAI embeddings (uses `OPENAI_API_KEY` env var)
- **Team / remote access** — host `0.0.0.0`, auto-generated 32-hex admin token

Click **Save to disk** to write the new config (with a timestamped `.bak` backup). Then restart `remember start` to pick up the changes.

## 6. Build a custom view

Frontmatter is queryable. Visit `/admin/views` for a sortable, filterable table over your corpus.

![Table view](./images/05-table-view.png)

Try these:

```
/admin/views?filter[tags]=runbook
/admin/views?filter[owner]=platform&sort=severity
/admin/views?filter[status]=stable&columns=path,title,tags,owner&sort=-modified
```

Filter rules AND together. Sort by any system column (`path`, `modified`, `title`, `size`, `last_indexed`) or any frontmatter key (use `-key` for descending). Pick columns via the comma-separated input. Bookmark the URL — that's your saved view.

Four built-in preset views at the bottom of the page:

- **Runbooks by severity** — all pages tagged `runbook`, sorted by severity
- **ADRs newest first** — architecture decision records by date
- **Platform-owned** — everything owned by the platform team
- **Recently modified** — latest 30 pages by modification time

## 7. Wire up a connector

Connectors pull external markdown sources into your index. Edit `remember.config.ts`:

```ts
import { defineConfig, defaults } from '@useremember/core';

export default defineConfig({
  // ...
  connectors: [
    defaults.connector.obsidian({
      vaultPath: '~/Documents/Obsidian Vault',
      transformWikilinks: true,
      tag: 'obsidian',
    }),
  ],
});
```

Restart `remember start`. On boot, the connector manager runs an initial sync — your Obsidian vault gets copied to `content/external/obsidian/`, `[[wikilinks]]` are rewritten to `[text](./slug)` form, and a `tag: obsidian` is injected into every page's frontmatter so you can filter on it.

Manage connectors at `/admin/connectors`:

![Connectors page](./images/07-connectors.png)

Each card shows the kind, target directory, configured state, last sync time, and a sync-now button. The Granola connector works the same way but pulls from an HTTP API:

```ts
defaults.connector.granola({
  apiUrl: process.env.GRANOLA_API_URL,
  apiKey: process.env.GRANOLA_API_KEY,
  since: '2026-01-01',
  tag: 'meeting',
  includeTranscript: false,
}),
```

The generic `filesystem` connector accepts any source path — useful for plain-folder syncs from team shares, exported notebooks, etc.

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
      const r = await fetch(`http://localhost:4320/v1/pages/${encodeURIComponent(block.input.path)}?format=text`);
      result = await r.text();
    } else if (block.name === 'list_pages') {
      const r = await fetch(`http://localhost:4320/v1/pages?limit=${block.input.limit ?? 50}`);
      result = await r.json();
    }
    // Continue the conversation with the tool result...
  }
}
```

No special integration on the wiki side — `remember` is just an HTTP server, and the tool definitions are auto-generated.

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

- A running wiki at `http://localhost:4321`
- 4 pages indexed (3 starter + your `deploy-runbook.md`)
- Hybrid search returning results from both BM25 and vector retrievers
- A custom config built via the setup wizard
- A saved view URL bookmarkable for any frontmatter filter
- A connector pulling external content into the same index
- An AI agent that can search and read pages via `/v1/tools`

## Next

- [Architecture overview](./architecture.md) — pipeline, adapters, performance numbers, the v2-cloud sketch
- [`examples/sample-wiki/`](../examples/sample-wiki/) — 25-page reference wiki used in development
- [`CHANGELOG.md`](../CHANGELOG.md) — wave-by-wave history of what shipped
- [Issue tracker](https://github.com/aakusch/remember/issues) — questions, bugs, feature requests
