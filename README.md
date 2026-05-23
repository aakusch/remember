# remember

> Your wiki. Your data. Your AI. **Local-first.**

`remember` is a free, open-source, AI-ready wiki platform. Drop markdown files in a folder, run one command, and your knowledge base is instantly searchable — by you, by your AI agents, by anything that speaks HTTP.

- **Local-first.** Zero outbound calls by default. Runs entirely on your machine.
- **AI-plugs-in.** Hybrid (BM25 + vector + rerank) search over your markdown via a tiny HTTP API. Drop-in tool definitions for Claude / GPT.
- **Markdown-canonical.** Edit in Obsidian, VS Code, Cursor, or anything else. Files are the source of truth; git is your version control.
- **Browser admin.** First-run setup wizard, settings UI, structural ops (move / delete / rename folders) — all from the browser.
- **MIT licensed.**

## Quick start

```bash
npx @remember/cli init my-wiki
cd my-wiki
npx @remember/cli dev
```

Open `http://localhost:4321/admin/setup` and walk the wizard. Indexing kicks off automatically. From there your wiki is live and AI-queryable at `GET /v1/search?q=...`.

> **Status:** v1 in active development. The repo is scaffolded; implementation lands progressively. See [`docs/superpowers/specs/`](./docs/superpowers/specs/) for the v1 design.

## What you get out of the box

| | |
|---|---|
| **Hybrid search** | BM25 (FTS5) + vector (sqlite-vec) + reciprocal rank fusion |
| **Local embeddings** | Bundled onnx model (BAAI/bge-small-en-v1.5, 384-dim) — no API key required |
| **OpenAI opt-in** | Set `OPENAI_API_KEY` to upgrade embeddings |
| **Drop-in AI tools** | `GET /v1/tools` returns Anthropic / OpenAI tool definitions |
| **Browser admin** | Setup wizard, settings, reindex, folder ops |
| **File watcher** | Edits in your editor → reindex in <1s |
| **Pluggable** | Walker, Parser, Chunker, Embedder, Store, SearchEngine, Reranker — all adapter interfaces |

## Architecture

Two packages:

- [`@remember/core`](./packages/core) — headless engine: indexer, embeddings, HTTP API, CLI
- [`@remember/viewer`](./packages/viewer) — browser viewer + admin (Astro + React islands)

Both ship together. Use just `@remember/core` if you have your own UI.

## Configuration

`remember.config.ts` at the root of your wiki:

```ts
import { defineConfig, defaults } from '@remember/core';

export default defineConfig({
  name: 'My Knowledge Base',
  content: './content',
  pipeline: {
    embedder: defaults.embedder.localOnnx({ model: 'BAAI/bge-small-en-v1.5' }),
    chunker:  defaults.chunker.smartSplit({ size: 900, overlap: 0.15 }),
    store:    defaults.store.sqliteVec({ path: '.remember/index.db' }),
  },
  search: {
    engine: defaults.search.hybrid({ topK: 20, finalK: 10 }),
  },
});
```

Full config schema: see [`docs/superpowers/specs/2026-05-23-remember-platform-design.md`](./docs/superpowers/specs/2026-05-23-remember-platform-design.md).

## Roadmap

- **v1.0** (in flight) — lean OSS local-first; this README is the v1 surface
- **v1.1** — cross-encoder reranker, Homebrew tap, standalone binary, curl one-liner installer
- **v1.2** — in-browser markdown editing, page schemas, brand/theme
- **v1.3** — RBAC + OIDC/SAML
- **v2.0** — managed cloud SaaS (multi-tenant, hosted Postgres+pgvector, team workspaces)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — see [LICENSE](./LICENSE).
