# Contributing to remember

Thanks for being here. `remember` is an early-stage OSS project — small, friendly, opinionated. PRs welcome.

## Quick contributor setup

```bash
git clone https://github.com/OWNER/remember.git
cd remember
pnpm install                      # installs all workspace deps
pnpm --filter @remember/core build
pnpm --filter @remember/core test
```

Requirements: Node 20+, pnpm 9+.

## Run the dev stack

Two terminals:

```bash
# Terminal 1 — core API on :4320 with the bundled sample wiki
cd examples/sample-wiki
node ../../packages/core/bin/remember.js start
```

```bash
# Terminal 2 — viewer on :4321
pnpm --filter @remember/viewer dev
```

Then open http://localhost:4321 to browse and edit.

## Repo layout

```
remember/
  packages/
    core/         @remember/core — headless engine
      src/
        api/      Hono server + routes
        cli/      CLI commands
        chunkers/ smart-split + adapter
        config/   defineConfig + Zod schema + jiti loader
        connectors/ Obsidian + Granola + filesystem + manager
        embedders/  local-onnx + openai + hash
        indexer/   walker → parser → chunker → embedder → store pipeline
        parsers/  remark + gray-matter
        rerankers/ passthrough (cross-encoder reserved for v0.1)
        search/   hybrid + RRF
        stores/   sqlite-vec (with pages, page_attrs, fts_chunks, vec_chunks)
        walkers/  chokidar walker with ignore rules
      tests/      vitest
    viewer/       @remember/viewer — Astro 5 SSR
      src/
        layouts/  Layout.astro (header, sidebar, tab bar, footer, global CSS)
        components/  Sidebar, TreeItem, Breadcrumbs, Toc
        lib/      api client + tree helpers
        pages/    `/`, `/[...slug]`, `/search`, `/admin/*`
  examples/
    sample-wiki/  Reference wiki used in tests + as `remember init` source
    sample-vault/ Mock Obsidian vault used by the obsidian connector demo
  docs/
    getting-started.md
    architecture.md
    superpowers/specs/  Design docs
  .github/workflows/    CI
  Dockerfile + docker-compose.yml
```

## Workflow

- All work happens off `main` via feature branches.
- PRs need green CI (lint, typecheck, tests) and one reviewer.
- Conventional commits preferred: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.
- Adapter interfaces are versioned; any breaking change to an adapter requires a major bump on `@remember/core`.

## Tests

The core has a vitest suite that covers each adapter contract + end-to-end indexer/search/API behavior:

```bash
pnpm --filter @remember/core test
```

When you add a new adapter implementation, it should pass the contract test for its kind. New API endpoints get an `api.test.ts` case.

## Adding a new adapter

Each pipeline component (`Walker`, `Parser`, `Chunker`, `Embedder`, `Store`, `SearchEngine`, `Reranker`, `Connector`) is an interface. To add a new implementation:

1. Implement the interface from [`packages/core/src/types.ts`](./packages/core/src/types.ts) (or [`connectors/types.ts`](./packages/core/src/connectors/types.ts) for connectors).
2. Add it under `packages/core/src/<adapter-kind>/<name>.ts`.
3. Export it from [`packages/core/package.json`](./packages/core/package.json)'s `exports` block.
4. Add a factory to [`packages/core/src/config/defaults.ts`](./packages/core/src/config/defaults.ts) if it's a sensible default option.
5. Add a contract test under `packages/core/tests/contracts/<adapter-kind>.contract.test.ts` (or extend the existing one).

## Code style

- TypeScript strict mode is on. No `any`.
- No `// removed code` comments — delete and trust git.
- Names beat comments. Comments explain *why*, never *what*.
- Tests verify behavior. They don't repeat the spec.

## License

By contributing, you agree your contributions will be licensed under MIT.
