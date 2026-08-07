# CLAUDE.md — remember (open-source engine)

Operating brief for an agent working in this repo. Read this before editing.

## What this is

`@useremember/core` — the **MIT, open-source "basic" retrieval engine** for `remember`.
The latest published npm release is `0.2.6` (public); the in-tree version is `0.3.0`, which
is **staged but not yet published** (it removes the built-in connectors — a breaking change —
so it needs a deliberate release). Local-first, **CLI + HTTP API only — there is no browser
UI in this repo.** It is a real, useful search engine and the top of the funnel.

The **pro engine** — the quality levers, the browser viewer, subwikis, scoped API keys,
doc-health, and multi-format (HTML/DOCX) ingestion — is a **separate PRIVATE package and is
not in this repo.** It is a distinct proprietary engine built on top of this core, not the
same binary — do not reference, import, or assume any of it here, and never claim Pro/Cloud
run "the same engine."

Engine: hybrid **BM25 (SQLite FTS5) + vector (sqlite-vec, local BGE embeddings)** fused with
**Reciprocal Rank Fusion**. One index, queried by people and agents over HTTP.

`packages/core` is the whole thing: `cli/`, `api/`, `search/` (the query path — start at
`search/hybrid.ts`), `indexer/`, `stores/` (sqlite-vec), `parsers/`, `embedders/`, `chunkers/`,
`benchmarks/`. CLI commands: `setup · init · index · search · list · get · status · doctor ·
mcp · tools · capabilities · dev · start · benchmark`. `remember dev` runs the API with
file-watch (reindex within ~1s); `remember mcp` serves the wiki to MCP clients over stdio —
**CLI + API only, no browser UI**.

**No built-in connectors.** Ingestion is deliberately not the engine's job: the wiki is plain
markdown, so the user's agent (or the user) writes markdown into `content/` — pulling from Granola,
Obsidian, exports, etc. Managed/turnkey connectors are a *Pro* concern. Do not add source-specific
connectors (Granola API, Obsidian sync) back into this repo. See `content/remember.md`'s
"bring content in" section for the agent-as-connector pattern.

## Hard rules

**The honesty contract is load-bearing — never soften it.** The engine *does not know when it
does not know*: a returned result is **ranked text for the query, not evidence that an answer
exists**, and `score` is a **fused rank score, not a probability** (comparable within one
result set, meaningless across queries). This is stated in the CLI output and the API — keep
the wording consistent across the CLI, the `/v1/search` response + OpenAPI description, and the
README. Publishing the engine's limits is deliberate positioning, not a rough edge to polish
away.

**Evidence over assertion for anything ranking-related.** `rrfK` defaults to **10**
(`search/hybrid.ts`). Every performance/quality claim needs a committed artifact under
`benchmarks/results/`; negative results get committed too. Do not change the default ranking,
`rrfK`, or the fusion weights without a before/after artifact proving it.

**Do not edit the committed benchmark fixture.** `examples/sample-wiki/content/` and
`benchmarks/retrieval/sample-wiki.questions.jsonl` are the deterministic gate — create a *new*
fixture rather than mutating them.

**Markdown only.** The only parser is `parsers/remark.ts`. HTML/DOCX ingestion is a *pro*
feature and is deliberately not in this engine — don't add a second parser here.

## Things that look inert but are intentional — do NOT "tidy" them

- **`query-planners/passthrough.ts` and `rerankers/none.ts`** are deliberate no-op seams: the
  query path is built so a real planner / cross-encoder reranker *could* slot in, and the OSS
  engine ships the passthrough/none versions on purpose. Don't delete the seams or the
  `@deprecated`/placeholder markers in `search/`.
- **`lexicalTieBreak`** (`search/hybrid.ts`, default `false`) is an opt-in tie-breaker that only
  reorders exact fused-score ties. It is off by default **on evidence** (measured net-neutral on
  the bundled corpus). Don't flip the default without a benchmark on harder fixtures.

## The `/v1/search` contract

Each result carries a fixed field set — `path, title, snippet, score, frontmatter,
heading_path, retrievers, chunk_id` — enforced by a whitelist projection, not a spread of the
internal result. Don't widen it casually. `GET /v1/capabilities` (and `remember capabilities`)
expose a stable, versioned discovery object for agents from one source of truth — keep it in
step with what the engine actually does.

## Open-core boundary

This repo is the **MIT basic engine** and stays that way. When a sibling repo's copy says
"`@useremember/core` is MIT," that is a true statement about **this** package — don't "fix" it
to something else. Keep pro-only concepts out of this codebase and its docs.

## Roadmap SSOT (maintainers)

The cross-product roadmap that spans OSS, Pro, and Cloud lives in the **private**
`remember-internal` repo at `product/roadmap-internal.md` — that is the source of truth for
prioritization, and it does **not** belong in this public repo. Public-facing roadmap signals
that *do* live here: `CHANGELOG.md` (wave-by-wave shipped history) and the GitHub issue
tracker. Note: `CHANGELOG.md` currently trails the code — it stops at `0.2.3` and needs
`0.2.4`–`0.3.0` entries (doctor, setup, mcp, connector removal, optional-peer embeddings).

## Dev / build / test

```bash
pnpm install
pnpm build       # tsc
pnpm typecheck
pnpm test        # full suite
# benchmark harness:
pnpm --filter @useremember/core benchmark -- --help
```
