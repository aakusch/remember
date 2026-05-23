# remember

> Your wiki. Your data. Your AI. **Local-first.**

`remember` is a free, open-source, AI-ready wiki platform. Drop markdown files in a folder, run one command, and your knowledge base is instantly searchable — by you, by your AI agents, by anything that speaks HTTP.

[![CI](https://github.com/OWNER/remember/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/remember/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](.nvmrc)

```bash
npx @remember/cli init my-wiki
cd my-wiki
npx @remember/cli dev
# → http://localhost:4321
```

That's the entire install. Zero outbound network calls by default. No API keys required.

---

## What you get

| | |
|---|---|
| **Hybrid search** | BM25 (sqlite FTS5) + vector (sqlite-vec) + Reciprocal Rank Fusion. ~2ms per query on a typical wiki. |
| **Local embeddings** | Bundled ONNX model (`BAAI/bge-small-en-v1.5`, 384-d, ~80MB). No API key, no outbound calls. |
| **OpenAI opt-in** | Set `OPENAI_API_KEY` to upgrade embeddings — your choice. |
| **Drop-in AI tools** | `GET /v1/tools` returns Anthropic/OpenAI-shaped tool definitions. Wire Claude or GPT to your wiki in 30 seconds. |
| **Browser editor** | Markdown editor with live preview, slash commands (`/h1`, `/code`, `/table`, `/mermaid`, 16 more), Cmd+S to save. |
| **Table view** | Query frontmatter as a sortable, filterable table — `/admin/views?filter[tags]=runbook`. |
| **Multi-tab nav** | Sticky tab bar across pages, persisted in localStorage. |
| **Live reload** | File watcher → incremental reindex → SSE → viewer auto-refreshes. Edits in your editor of choice show up in <1s. |
| **Connectors** | Pull external sources (Obsidian vaults, Granola meetings, any folder) into the same index. |
| **Setup wizard** | `/admin/setup` with presets, model dropdown, diff-against-current indicators, saves directly to `remember.config.ts`. |
| **Filesystem-canonical** | Plain markdown files. Plays with Obsidian, Cursor, VS Code, Dropbox, git. No proprietary format. |
| **Pluggable** | Walker · Parser · Chunker · Embedder · Store · SearchEngine · Reranker · Connector — every adapter has a documented interface. |

---

## Install

### Quickstart (recommended)

```bash
npx @remember/cli init my-wiki    # scaffolds a starter wiki
cd my-wiki
pnpm install                      # or: npm install
pnpm dev                          # or: npx @remember/cli dev
```

Open http://localhost:4321 and follow the in-browser setup wizard.

### From source (this monorepo)

```bash
git clone https://github.com/OWNER/remember.git
cd remember
pnpm install
pnpm --filter @remember/core build
pnpm --filter @remember/viewer dev          # viewer on :4321
# In another shell:
cd examples/sample-wiki
node ../../packages/core/bin/remember.js start   # API on :4320
```

The `examples/sample-wiki/` ships 19 realistic pages across `engineering/`, `ops/`, `product/`, `people/` so you can see the full UX immediately.

### Docker

```bash
docker run -d \
  -p 4320:4320 -p 4321:4321 \
  -v $(pwd)/my-wiki:/wiki \
  -w /wiki \
  ghcr.io/OWNER/remember:latest dev
```

Or with `docker compose`:

```bash
git clone https://github.com/OWNER/remember.git
cd remember
docker compose up
```

See [`docker-compose.yml`](./docker-compose.yml) for the full configuration.

---

## How AI plugs in

Two patterns, no special integration:

**Pattern A — raw HTTP:**

```bash
curl 'http://localhost:4320/v1/search?q=how+do+we+rollback'
# → [{ path, snippet, score, retrievers: ["bm25","vector"], frontmatter, ... }]
```

**Pattern B — drop-in tool definitions:**

```bash
curl http://localhost:4320/v1/tools
# Returns Anthropic/OpenAI tool definitions for search_wiki, get_page, list_pages.
# Drop straight into a tool-use call.
```

Your AI can now answer questions over your wiki without you wiring anything else.

---

## Connectors

Pull external sources into the same searchable corpus.

```ts
// remember.config.ts
import { defineConfig, defaults } from '@remember/core';

export default defineConfig({
  connectors: [
    defaults.connector.obsidian({
      vaultPath: '~/Obsidian/My Vault',
      transformWikilinks: true,
      tag: 'obsidian',
    }),
    defaults.connector.granola({
      apiUrl: process.env.GRANOLA_API_URL,
      apiKey: process.env.GRANOLA_API_KEY,
      since: '2026-01-01',
      tag: 'meeting',
    }),
  ],
});
```

Synced files land in `content/external/<connector>/` and flow through the normal pipeline — auto-indexed, searchable, render in the viewer. Background sync on boot; manual `POST /v1/connectors/<name>/sync` from `/admin/connectors`.

---

## Architecture

```
┌─────────────────────┐         ┌─────────────────────┐
│   @remember/core    │  HTTP   │  @remember/viewer   │
│  ─────────────────  │ ◄─────► │  ─────────────────  │
│  • CLI              │   SSE   │  • Astro + React    │
│  • Indexer          │         │  • Renderer         │
│  • HTTP API (Hono)  │         │  • Editor           │
│  • Embedder         │         │  • Admin            │
│  • SQLite + vec0    │         │  • Table view       │
│  • Connectors       │         │  • Setup wizard     │
└─────────────────────┘         └─────────────────────┘
        ▲
        │
┌───────┴───────────────────────────────────────┐
│  ~/my-wiki/                                   │
│    content/         markdown (canonical)      │
│      ↳ external/    connector outputs         │
│    remember.config.ts                          │
│    .remember/index.db   SQLite + sqlite-vec   │
└───────────────────────────────────────────────┘
```

Two packages, one pnpm-workspaces monorepo. Core is headless — use it standalone with your own UI. Viewer is opt-in. Both ship together; both are MIT.

Full design in [`docs/superpowers/specs/2026-05-23-remember-platform-design.md`](./docs/superpowers/specs/2026-05-23-remember-platform-design.md).

---

## Configuration

Minimal config:

```ts
import { defineConfig } from '@remember/core';
export default defineConfig({});
```

Comprehensive config — see [`examples/sample-wiki/remember.config.ts`](./examples/sample-wiki/remember.config.ts) — covers every knob: server bind, ports, admin token, pipeline adapters, search engine, viewer landing, connectors.

Or use the in-browser [Setup wizard](./docs/getting-started.md#setup-wizard) to build and save the config interactively.

---

## Roadmap

| Version | Highlights |
|---|---|
| **v0.0.1** | Lean OSS local-first — *current* |
| v0.1 | Cross-encoder reranker, brew tap, standalone binary |
| v0.2 | Block-level references, backlinks panel |
| v0.3 | RBAC + OIDC/SAML, branding/theme config |
| **v1.0** | First production-ready release |
| v2.0 | **Cloud premium** — managed multi-tenant SaaS, hosted pgvector, team workspaces |

See [`CHANGELOG.md`](./CHANGELOG.md) for the full history.

---

## Why this vs Obsidian / Notion / SiYuan / Outline

- **vs Obsidian** — server-side hybrid search + HTTP API + browser viewer. Obsidian is desktop-only and lacks a programmatic API.
- **vs Notion** — your files, your machine, your AI. Notion locks data in their cloud.
- **vs SiYuan** — markdown-canonical, not a proprietary `.sy` format. Plays with your existing git workflow.
- **vs Outline** — designed *for* AI integration from day one. Outline is a wiki that you can bolt AI onto.

Comparison matrix: [docs/comparisons.md](./docs/comparisons.md) (coming soon).

---

## Contributing

We're at v0 — small, friendly, opinionated. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

Issue templates: [`.github/ISSUE_TEMPLATE/`](./.github/ISSUE_TEMPLATE/).
Open a discussion or file an issue. PRs welcome on anything tagged `good-first-issue`.

---

## License

MIT — see [`LICENSE`](./LICENSE).

---

<sub>Built with care. Use it for anything.</sub>
