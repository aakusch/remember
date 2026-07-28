<div align="center">

# remember

**Search built for agents. Local-first, CLI-first, open source.**

A free, open-source retrieval engine for Markdown knowledge. It indexes,
ranks, and serves source-cited evidence to humans and agents — entirely on your
machine by default. Drive it from a rich terminal CLI or a small HTTP API.

[![CI](https://github.com/aakusch/remember/actions/workflows/ci.yml/badge.svg)](https://github.com/aakusch/remember/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](.nvmrc)

[Quickstart](#quickstart) · [The CLI](#the-cli) · [Tutorial](./docs/getting-started.md) · [Architecture](./docs/architecture.md)

</div>

<br>

## Quickstart

```bash
npx @useremember/core init my-wiki
cd my-wiki
pnpm install     # or: npm install
pnpm dev         # index, then serve the agent API with a live file watcher
```

Then, in another terminal, search it:

```bash
remember search "how do deploys work" -k 5
```

That's the entire install. No API keys required. Local semantic search is
powered by the optional [`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers)
dependency, which the default scaffold installs for you. On the first index it
downloads a small embedding model (`BAAI/bge-small-en-v1.5`, ~100 MB) once and
caches it locally; after that, indexing and search run entirely offline.

If `@huggingface/transformers` is not installed, `remember` prints a loud
placeholder-embedder warning and search returns meaningless results — install
it with `npm install @huggingface/transformers`, or set `OPENAI_API_KEY` to use
OpenAI embeddings instead.

Other install paths: [from source](#from-source) · [Docker](#docker).

> **Looking for the browser UI?** As of v0.2.0 the open-source engine is
> **CLI + API only**. The browser viewer/editor is now a **Pro** feature, and
> the previously-published `@useremember/viewer` npm package is deprecated. The
> OSS experience is the terminal CLI documented below.

<br>

## What it does

| | |
|---|---|
| **Hybrid retrieval engine** | BM25 (SQLite FTS5) + vector (sqlite-vec) + Reciprocal Rank Fusion, path/heading signals, page diversity, and an inspectable ranking trace. |
| **Rich terminal CLI** | `init`, `dev`, `start`, `index`, `search`, `status` — formatted result cards, aligned dashboards, a restrained color palette, `NO_COLOR` + non-TTY aware. |
| **`remember search`** | Hybrid search straight from your terminal. Ranked cards with matched terms highlighted, `-k`, `--open`, and `--json` for scripts and agents. |
| **Agent HTTP API** | Small Hono server: `GET /v1/search`, `/v1/pages`, and `/v1/tools` (Anthropic/OpenAI-shaped tool definitions — drop into a tool-use call). |
| **Local embeddings** | Local `BAAI/bge-small-en-v1.5` ONNX model (384-d) via the optional `@huggingface/transformers` dependency. OpenAI is opt-in via `OPENAI_API_KEY`. |
| **Live reload** | Filesystem watcher → incremental reindex in <1 s. Edit in your editor of choice; the index keeps up. |
| **Connectors** | Pull external sources (Obsidian vault, Granola meetings, any folder) into the same searchable index. |
| **Filesystem-canonical** | Plain markdown in a directory. Plays with Obsidian, Cursor, VS Code, Dropbox, git. No proprietary format. |
| **Pluggable** | Walker · Parser · Chunker · Embedder · Store · SearchEngine · Reranker · Connector — every adapter has a documented interface. |
| **MIT licensed** | Use it for anything. |

<br>

## The CLI

Everything the OSS engine does is a `remember` subcommand. Run `remember help`
for the full list, or `remember help <command>` for per-command help.

```
remember init <dir>       Scaffold a new wiki (config + content + starter docs)
remember dev              Index, then serve the agent API with a file watcher
remember start            Serve the production API (assumes the index is built)
remember index            (Re)index the content directory
remember search "<q>"     Hybrid search, formatted result cards (or --json)
remember status           Dashboard: page/chunk counts, model, index freshness
remember benchmark        Versioned retrieval evaluation
```

### `remember search`

```bash
remember search "rollback procedure" -k 5
```

Prints ranked cards — rank, score, path, title, and a query-relevant snippet
with the matched terms highlighted. Flags:

- `-k <n>` — number of results (default 10, max 50)
- `--json` — clean, color-free machine output for scripts and agents
- `--open` — open the top result in `$EDITOR` (falls back to `$PAGER` / `less`)

```bash
# Feed an agent or a script:
remember search "auth flow" --json | jq '.results[0].path'
```

Color is enabled on a TTY and disabled automatically when piped or when
`NO_COLOR` is set, so redirected output and CI logs stay clean.

<br>

## How AI plugs in

Two patterns, no special integration.

**Pattern A — the CLI, as a tool** (any agent that can run a shell command):

```bash
remember search "how do I rollback" -k 5 --json
```

**Pattern B — raw HTTP** (any client that can `curl`):

```bash
curl 'http://localhost:4320/v1/search?q=how+do+I+rollback&k=5'
```

```json
{
  "query": "how do I rollback",
  "results": [
    {
      "path": "engineering/runbooks/rollback.md",
      "snippet": "Use this when a deploy needs to be reverted…",
      "score": 0.0328,
      "retrievers": ["bm25", "vector"],
      "frontmatter": { "severity": "high", "owner": "platform" }
    }
  ],
  "query_ms": 3
}
```

**Pattern C — drop-in tool definitions** (Claude, GPT, any tool-calling LLM):

```bash
curl http://localhost:4320/v1/tools
```

Returns Anthropic/OpenAI-compatible tool definitions for `search_wiki`,
`get_page`, `list_pages`. Drop them straight into a tool-use call — no wiring
code needed.

**The honesty contract.** A returned result means the corpus contains text that
ranked for the query. It is **not** proof that an answer exists. If the right
document isn't in the corpus, the engine still returns its closest matches —
treat results as candidates to read, not as guaranteed answers.

<br>

## Retrieval benchmark

Search changes are checked against a versioned 30-query fixture spanning
exact, semantic, ambiguous, multi-document, contradictory, and unanswerable
cases. The deterministic CI profile is fully offline:

```bash
pnpm --filter @useremember/core benchmark -- \
  --profile ci \
  --output ../../benchmarks/results/latest-ci.json
```

It reports recall@1/5/10, candidate recall, MRR, nDCG@5/10,
wrong-source/empty-result rates, latency percentiles, per-query failures, and
per-class breakdowns. The separate `fast` release profile uses local BGE
embeddings and may download that model when explicitly selected. See
[`benchmarks/retrieval/README.md`](./benchmarks/retrieval/README.md).

<br>

## Connectors

Pull external sources into the same indexed corpus:

```ts
// remember.config.ts
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
      since: '2026-01-01',
      tag: 'meeting',
    }),
  ],
});
```

The connector manager runs an initial sync on boot, then exposes per-connector
and "sync all" triggers through `/v1/connectors`.

<br>

## Install options

### Quickstart (recommended)

```bash
npx @useremember/core init my-wiki
cd my-wiki
pnpm install
pnpm dev
```

### From source

For working on `remember` itself, or running against the bundled sample wiki:

```bash
git clone https://github.com/aakusch/remember.git
cd remember
pnpm install
pnpm --filter @useremember/core build
./scripts/dev.sh                  # indexes + serves examples/sample-wiki on :4320
```

The `scripts/dev.sh` helper starts the API on :4320 against
`examples/sample-wiki/` (25 pages, frontmatter-rich, runbook + ADR + product +
people content).

### Docker

```bash
docker compose up
```

See [`docker-compose.yml`](./docker-compose.yml) for volume mounts and env vars.
The image is multi-stage (build in Node 20-slim, runtime is also slim with the
build artifacts copied over) and runs `remember start` by default. Healthcheck
on `/v1/health` every 15 s.

<br>

## Configuration

Minimum:

```ts
import { defineConfig } from '@useremember/core';
export default defineConfig({});
```

Everything has sensible defaults. Hand-write a config referencing
[`examples/sample-wiki/remember.config.ts`](./examples/sample-wiki/remember.config.ts)
for a comprehensive example.

Full schema reference: [`docs/getting-started.md#configuration-reference`](./docs/getting-started.md#configuration-reference).

<br>

## Architecture

One package, published to npm:

- **`@useremember/core`** — the headless engine. Rich CLI + HTTP API + indexer +
  search + adapters. Node-only. Standalone-usable.

```
┌──────────────────────────────────────────┐
│              @useremember/core            │
│  ──────────────────────────────────────  │
│  • CLI (init · dev · search · status …)   │
│  • Indexer (walk → parse → chunk → embed) │
│  • HTTP API (Hono): /v1/search /v1/tools  │
│  • Embedder (local ONNX · OpenAI)         │
│  • SQLite + vec0 store                     │
│  • Connectors                              │
└──────────────────────────────────────────┘
```

The browser viewer/editor is a **Pro** feature and lives outside this
repository. Full architecture deep dive:
[`docs/architecture.md`](./docs/architecture.md).

<br>

## Roadmap

| Version | Highlights |
|---|---|
| v0.0.1 | Lean local-first OSS foundation |
| v0.1 | Retrieval benchmark, corrected candidate pipeline, optional intent, structured traces, evidence packages |
| **v0.2** | **CLI-first OSS** — first-class `remember search`, formatted CLI output, browser UI moves to Pro — *current* |
| v0.3 | RBAC + OIDC/SAML auth |
| **v1.0** | First production-stable release |
| v2.0 | **Cloud premium** — managed multi-tenant SaaS with pgvector + S3 + team workspaces |

See [`CHANGELOG.md`](./CHANGELOG.md) for the full wave-by-wave history.

<br>

## Why this vs alternatives

- **vs Obsidian** — `remember` runs a server and a CLI, so it has a real HTTP API and hybrid search index. Obsidian is desktop-only with no programmatic surface for AI agents.
- **vs Notion / Confluence** — your files, your machine, your AI. No cloud lock-in, no per-seat pricing, no API rate limits.
- **vs SiYuan** — markdown-canonical, not a proprietary `.sy` format. Plays nicely with git, Cursor, VS Code, Obsidian — anything that reads `.md`.
- **vs Outline / BookStack** — designed *for* AI integration from day one. `remember search --json` and `/v1/tools` ship out of the box; you don't have to bolt on a separate AI layer.

<br>

## Contributing

`remember` is small and friendly. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev setup, then check [issue templates](./.github/ISSUE_TEMPLATE/) for bug reports and feature requests.

PRs welcome on:

- New connector implementations (`@useremember/core/connectors/<name>.ts`)
- New embedder providers (Voyage, Cohere, etc.)
- New rerankers (cross-encoder, LLM-based)
- Query planners and retrieval evaluation fixtures
- CLI ergonomics and output formatting
- New API clients (Python, Go, Rust)
- Documentation improvements

Tagged `good-first-issue` are the easiest entry points.

<br>

## License

[MIT](./LICENSE) — use it for anything, commercial or otherwise.

<br>

<div align="center">

<sub>Made with care. Local-first by design.</sub>

</div>
