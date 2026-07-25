# remember — notes for the next agent

Open-core retrieval engine over a team's markdown knowledge base, queried by AI
agents. `packages/core` is the engine and CLI; `packages/viewer` is the UI.

**Read first:** [`docs/retrieval-review-request.md`](docs/retrieval-review-request.md).
It carries the current state, the measured numbers, the lessons learned, what we
explicitly *do not* trust about our own results, and the open questions. Start
there before forming an opinion about the engine.

Then, as needed:
- `docs/architecture.md` — overall shape
- `packages/core/src/search/hybrid.ts` — the entire query path in one file
- `benchmarks/retrieval/README.md` — what each fixture measures and its limits
- `docs/authoring-for-retrieval.md` — how documents must be written to be findable
- `docs/agent-search-guide.md` — how a calling agent should use the API

## Hard rules

**Never edit `examples/sample-wiki/content/` or
`benchmarks/retrieval/sample-wiki.questions.jsonl`.** Committed baseline
artifacts pin their `corpus_hash` and `questions_hash`. That fixture is the
deterministic CI gate. Create a new fixture instead.

**Every performance or quality claim needs a committed benchmark artifact.** This
repo's standard is evidence over assertion. Negative results get committed too —
see `3da0b63`, whose commit message says the feature does not work. Do not
describe something as improved without a before/after artifact in
`benchmarks/results/`.

**Bump `PIPELINE_REV` in `packages/core/src/cli/commands/benchmark-cmd.ts`
whenever you change anything on the indexing path** (parser, chunker, indexer).
The index cache keys on corpus + embedder + chunker options, so an indexing-path
change without a rev bump silently reuses stale indexes and reports confident
wrong numbers.

## Benchmarking

```bash
pnpm --filter @useremember/core benchmark -- \
  --profile fast --candidate-k 50 \
  --corpus <dir> --questions <jsonl> \
  --index-cache benchmarks/datasets/.index-cache
```

Flags: `--profile ci|fast`, `--corpus`, `--questions`, `--k`, `--candidate-k`,
`--rrf-k`, `--bm25-weight`, `--vector-weight`, `--status-demotion`, `--pooling`,
`--query-prefix`, `--reranker`, `--reranker-model`, `--index-cache`,
`--compare`, `--fail-on-regression`, `--output`.

- `ci` uses a deterministic hash embedder — reproducible, semantically
  meaningless. Never quote its scores as quality.
- `fast` uses local BGE and is the real signal. **Always pass `--index-cache`**
  or you re-embed for ~15 minutes per 20k-document fixture.
- BEIR fixture corpora are generated and gitignored; rebuild with
  `benchmarks/datasets/beir-fixture.mjs build`. `selection.json` pins the exact
  document set so `corpus_hash` reproduces.

**zsh trap:** do not pass benchmark flags via an unquoted shell variable. zsh
does not word-split, so the whole string arrives as one bogus argument, the run
dies, and a `grep` on the output hides the error.

## Reading the metrics

`recall@k` is the fraction of *all* correct documents found, and many fixture
questions have 2–3, so it understates practical usefulness. For product claims
use **"at least one correct document in the returned set"** — that is what an
agent consumer needs. `wrong_source_rate` is top-1 precision (or, for
unanswerable queries, "returned anything at all"). `candidate_recall` is the
ceiling: ranking can only reorder what retrieval found.

## Things that look implemented but are inert

Check before assuming a signal works:

- **`QueryInput.intent`** — accepted by the API, threaded through core, recorded
  in traces, consumed by nothing.
- **Query planner** — seam exists, `createPassthroughQueryPlanner` returns the
  query unchanged.
- **Reranker** — passthrough by default. A cross-encoder exists but measured
  net-negative; it stays opt-in.
- **`applyStatusDemotion`** — implemented and effective (rank-1 stale 54% → 8%
  on the confusables fixture) but **defaults to off**, because its generalisation
  to corpora without `status` frontmatter is unproven.

## Release state

`@useremember/core@0.1.0` is published to npm with `rrfK=60`. This branch
defaults to `10`, which is a behaviour change for every consumer and needs a
minor bump before release. Committed v0.1.0 baseline artifacts predate that
change and have not been regenerated.
