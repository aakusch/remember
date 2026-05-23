# Contributing to remember

Thanks for being here. `remember` is an early-stage OSS project.

## Local development

```bash
git clone https://github.com/<owner>/remember.git
cd remember
pnpm install
pnpm dev
```

Requirements: Node 20+, pnpm 9+.

## Repo layout

```
remember/
  packages/
    core/         @remember/core — headless engine
    viewer/       @remember/viewer — browser UI (Astro + React islands)
  examples/
    sample-wiki/  Reference wiki used in tests and `remember init --template sample`
  docs/
    superpowers/specs/   Design specs (live as the project evolves)
  .github/workflows/     CI
```

## Workflow

- All work happens off `main` via feature branches.
- PRs need green CI (lint, typecheck, tests) and one reviewer.
- Conventional commits preferred (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- Adapter interfaces are versioned; any breaking change to an adapter requires a major bump on `@remember/core`.

## Adding a new adapter

Each pipeline component (`Walker`, `Parser`, `Chunker`, `Embedder`, `Store`, `SearchEngine`, `Reranker`) is an interface. To add a new implementation:

1. Implement the interface
2. Add it under `packages/core/src/<adapter-kind>/<name>.ts`
3. Export it from `packages/core/package.json`'s `exports` block
4. Add it to `packages/core/src/config/defaults.ts` if it's a sensible default option
5. Pass the adapter contract test suite (`packages/core/tests/contracts/<adapter-kind>.contract.test.ts`)

## License

By contributing, you agree your contributions will be licensed under MIT.
