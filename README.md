<div align="center">

# remember

**Search built for agents. Local-first, CLI-first, open source.**

A free, open-source retrieval engine for Markdown knowledge. It indexes,
ranks, and serves source-cited evidence to humans and agents — entirely on your
machine by default. Drive it from a rich terminal CLI or a small HTTP API.

[![CI](https://github.com/aakusch/remember/actions/workflows/ci.yml/badge.svg)](https://github.com/aakusch/remember/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](.nvmrc)

[Quickstart](#quickstart) · [The CLI](#the-cli) · [Tutorial](./docs/tutorial.md) · [Architecture](./docs/architecture.md)

</div>

<br>

## Quickstart

One command — the guided wizard scaffolds the wiki, installs, indexes, and starts
the server (it asks about the folder, embeddings, and example pages first):

```bash
npx @useremember/core setup
```

Prefer to run the steps yourself? The wizard maps to:

```bash
npx @useremember/core init my-wiki
cd my-wiki
npm install      # pnpm / yarn work too
npm run dev      # index, then serve the agent API with a live file watcher
```

Then, in another terminal, search it:

```bash
npm run search -- "how do deploys work" -k 5   # or: npx --no-install remember search …
```

(`remember` lives in the project's `node_modules/.bin`. Run it through the
scaffolded npm scripts (`npm run <cmd> --`) or with `npx --no-install remember` —
note that a bare `npx remember` outside the project directory fetches an
unrelated npm package named `remember`. Or install globally:
`npm i -g @useremember/core` for a bare `remember`.)

That's the entire install. No API keys required. Local semantic search is
powered by the optional [`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers)
dependency, which the default scaffold installs for you. On the first index it
downloads a small embedding model (`BAAI/bge-small-en-v1.5`, ~100 MB) once and
caches it locally; after that, indexing and search run entirely offline.

If `@huggingface/transformers` is not installed, `remember` prints a loud
placeholder-embedder warning and search returns meaningless results — install
it with `npm install @huggingface/transformers`, or set `OPENAI_API_KEY` to use
OpenAI embeddings instead. See [Embeddings](#embeddings) for the full picture.

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
| **Rich terminal CLI** | `setup`, `init`, `dev`, `start`, `index`, `search`, `list`, `get`, `status`, `doctor`, `mcp`, `tools`, `capabilities`, `benchmark` — formatted result cards, aligned dashboards, a restrained color palette, `NO_COLOR` + non-TTY aware. |
| **`remember search`** | Hybrid search straight from your terminal. Ranked cards with matched terms highlighted, `-k`, `--open`, and `--json` for scripts and agents. |
| **Agent HTTP API** | Small Hono server: `GET /v1/search`, `/v1/pages`, `/v1/tools` (Anthropic/OpenAI-shaped tool definitions — drop into a tool-use call), and `/v1/capabilities` (one discovery object). |
| **Native MCP server** | `remember mcp` serves the wiki to any MCP client (Claude Desktop/Code, Cursor) over stdio — `search_wiki`, `get_page`, `list_pages`, `write_page`. |
| **Local embeddings** | Local `BAAI/bge-small-en-v1.5` ONNX model (384-d) via the optional `@huggingface/transformers` dependency. OpenAI is opt-in via `OPENAI_API_KEY`. |
| **Live reload** | Filesystem watcher → incremental reindex in <1 s. Edit in your editor of choice; the index keeps up. |
| **Agent-writable** | Your agent is the connector: it pulls external sources, converts them to markdown, and writes them into `content/` — directly or via `PUT /v1/pages`. |
| **Filesystem-canonical** | Plain markdown in a directory. Plays with Obsidian, Cursor, VS Code, Dropbox, git. No proprietary format. |
| **Pluggable** | Walker · Parser · Chunker · Embedder · Store · SearchEngine · Reranker — every adapter has a documented interface. |
| **MIT licensed** | Use it for anything. |

<br>

## The CLI

Everything the OSS engine does is a `remember` subcommand. Run `remember help`
for the full list, or `remember help <command>` for per-command help.

```
remember setup            Guided wizard: scaffold → install → index → serve
remember init <dir>       Scaffold a new wiki (config + content + starter docs)
remember dev              Index, then serve the agent API with a file watcher
remember start            Serve the production API (assumes the index is built)
remember index            (Re)index the content directory
remember search "<q>"     Hybrid search, formatted result cards (or --json)
remember list             List indexed documents as a table (or --json)
remember get <path>       Print one document's frontmatter + body (or --json)
remember status           Dashboard: page/chunk counts, model, index freshness
remember doctor           Corpus-health sweep: unfindable/duplicate/thin/no-frontmatter docs
remember mcp              Serve the wiki to MCP clients (Claude Desktop/Code, Cursor) over stdio
remember tools            Print agent tool defs (same as GET /v1/tools) (or --json)
remember capabilities     One discovery object for agents (same as GET /v1/capabilities)
remember benchmark        Versioned retrieval evaluation
```

Every read command (`search`, `list`, `get`, `status`, `tools`, `capabilities`)
takes `--json` with stable, documented shapes — see `remember help agents`.

### `remember search`

```bash
remember search "rollback procedure" -k 5
```

Prints ranked cards — rank, score, path, title, and a query-relevant snippet
with the matched terms highlighted. Flags:

- `-k <n>` — number of results (default 10, max 50)
- `--json` — clean, color-free machine output for scripts and agents
- `--open` — open the top result in `$EDITOR` (falls back to `$VISUAL` / `$PAGER` / `less`)

```bash
# Feed an agent or a script:
remember search "auth flow" --json | jq '.results[0].path'
```

Color is enabled on a TTY and disabled automatically when piped or when
`NO_COLOR` is set, so redirected output and CI logs stay clean.

### `remember doctor`

```bash
remember doctor
```

A deterministic, no-LLM, no-network health check over your indexed corpus.
It flags documents that quietly wreck retrieval: markdown on disk that isn't
indexed, pages with zero chunks (unfindable), duplicate bodies/titles, pages
with no heading structure, walls of prose, thin pages, and missing
frontmatter. Run it after your first `remember index` — it reads only the
local index plus one cheap pass over `content/`. Flags:

- `--json` — the machine shape (same as `GET /v1/doctor`)
- `--strict` — exit non-zero if any error-severity finding exists, so you can gate CI on it

<br>

## How AI plugs in

No special integration. An agent can discover the whole surface in one call —
`remember capabilities --json` (or `GET /v1/capabilities`) returns a single
stable object with the version, engine, embedder, every HTTP endpoint, every
CLI command, and a `json_schema_version` — so there's nothing to stitch
together from `status`, `tools`, and `health`. Then use one of the patterns
below.

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

**Pattern D — make "remember …" a reflex.** Add a few lines to your coding
agent's `CLAUDE.md` / `AGENTS.md` so that when you say "remember when we decided
X" or "remember how we structure this doc," the agent treats it as a retrieval
request and queries the wiki instead of guessing. `remember setup` prints the
exact snippet, and the seeded `content/remember.md` carries it too — so you can
point your agent at the wiki and let it wire itself up. remember never edits your
files; you (or your agent, with your ok) paste it in.

**Pattern E — native MCP tools** (Claude Desktop/Code, Cursor, any MCP client).
`remember mcp` serves the wiki over stdio as first-class tools — `search_wiki`,
`get_page`, `list_pages`, and `write_page` (stage a note). No HTTP server needed;
it runs against the wiki in its working directory. Add it to your client's
`mcpServers`:

```json
{
  "remember": { "command": "remember", "args": ["mcp"], "cwd": "/path/to/your-wiki" }
}
```

The snippet (Pattern D) tells the agent *when* to reach for the wiki; MCP is *how*
it calls it. `write_page` is the "we should remember this" side — the agent stages
a note and it's instantly findable.

**The honesty contract.** A returned result means the corpus contains text that
ranked for the query. It is **not** proof that an answer exists. If the right
document isn't in the corpus, the engine still returns its closest matches —
treat results as candidates to read, not as guaranteed answers. `score` is a
fused **rank** score, comparable within one result set and meaningless across
queries — not a probability or a confidence.

<br>

## Embeddings

Three ways the vector half of hybrid search gets its embeddings, in the order
the engine resolves them:

1. **OpenAI** — if `OPENAI_API_KEY` is set in the environment, the embedder
   switches to OpenAI. An explicit key is a deliberate opt-in and overrides
   the scaffold's local-ONNX pin; you can also pin a model with
   `defaults.embedder.openai(...)` in `remember.config.ts`.
2. **Local ONNX (the default)** — `BAAI/bge-small-en-v1.5` (384-d) via the
   [`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers)
   peer dependency, which the default scaffold installs for you. The engine
   declares it as an **optional peer**, so `npm install @useremember/core` on
   its own stays lean and audit-clean; a scaffolded wiki (or an explicit
   `npm install @huggingface/transformers`) opts into it. The model (~100 MB)
   downloads once on first index and is cached; after that, indexing and
   search run entirely offline. No API keys, no network.
3. **Hash placeholder (fallback)** — if `@huggingface/transformers` is not
   installed and no `OPENAI_API_KEY` is set, the engine falls back to a
   deterministic hash embedder. **Search still runs, but results are
   semantically meaningless** — this is an onboarding trap, so the engine
   prints a loud warning. Fix it with `npm install @huggingface/transformers`
   or by setting `OPENAI_API_KEY`.

> **A note on `npm audit`:** installing the engine alone is clean (0 known
> vulnerabilities). Once you add `@huggingface/transformers` for local
> embeddings, it transitively pulls in `sharp`, an image-processing library,
> and `npm audit` may report CVEs against it. This engine is text-only and
> never invokes the image path — but if your policy requires a clean audit,
> the OpenAI embedder path works without `@huggingface/transformers` installed.

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

## Bringing in external content

`remember` indexes plain markdown in `content/` and ships **no built-in
connectors** on purpose — your agent is the connector. To pull in an external
source (meeting notes, another tool's vault, an export), your AI agent (or
you) fetches it, converts it to markdown, and writes it into `content/`. Two
ways to land it:

- **Write files directly** — the watcher indexes new markdown within a second.
- **Over HTTP** — `PUT /v1/pages/<path>` with a JSON body
  `{ "body": "<markdown>" }` and the admin token
  (`Authorization: Bearer <token>`).

Managed, turnkey connectors are a **Pro** concern, not part of this MIT engine.

<br>

## Install options

### Quickstart (recommended)

```bash
npx @useremember/core init my-wiki
cd my-wiki
npm install      # pnpm / yarn work too
npm run dev
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
| **v0.2** | **CLI-first OSS** — first-class `remember search`, formatted CLI output, `remember setup` wizard, `remember doctor`, `remember mcp`, browser UI moves to Pro — *current on npm (0.2.6)* |
| v0.3 | Built-in connectors removed (breaking), optional-peer embeddings, pre-launch security hardening — *staged in-tree, not yet published* |
| **v1.0** | First production-stable release |
| v2.0 | **Cloud premium** — managed multi-tenant SaaS with pgvector + S3 + team workspaces |

Public roadmap signals: [`CHANGELOG.md`](./CHANGELOG.md) for the
wave-by-wave history of what shipped, and the
[issue tracker](https://github.com/aakusch/remember/issues) for planned and
in-flight work.

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
