# Retrieval evaluation expansion (Phase E)

Status: approved 2026-07-24
Scope: `remember` core only. No Cloud changes.

## Problem

The v0.1.0 retrieval rework shipped, but its quality gain is only measurable on
the deterministic `ci-hash` profile. On the real-embedding profile
(`BAAI/bge-small-en-v1.5`) the 30-query `sample-wiki` fixture is **saturated**:

| Metric | v0.0.1 | v0.1.0 |
|---|---:|---:|
| recall@5 | .980 | .980 |
| recall@10 | .980 | .980 |
| MRR | .980 | .980 |
| wrong-source rate | .200 | .200 |

There is no headroom left to detect an improvement. The two highest-leverage
seams in the pipeline — the query planner and the reranker — are both wired and
both **passthrough**, and we cannot justify filling them because we cannot
measure the result. A saturated benchmark makes every future ranking change
unfalsifiable.

Two follow-on efforts depend on this being fixed first:

- **A. Real reranker** — cross-encoder re-scoring of the candidate set.
- **B. Wrong-source guard** — verify the top result actually supports an answer,
  and abstain when it does not.

## Goals

1. Eval sets with genuine headroom on the real-embedding profile.
2. A real signal for `wrong_source` (top-1 precision) and for abstention.
3. Gold labels that are not hand-authored at scale.
4. Fast enough iteration to A/B a reranker.

## Non-goals

- Replacing the `sample-wiki` CI fixture. It stays exactly as-is: it is the
  deterministic offline gate, and its committed baselines depend on its
  `corpus_hash` / `questions_hash`. **Do not modify that corpus or its
  questions file.**
- Leaderboard comparability. We materialize *subsets* of public datasets, so
  absolute numbers are **not** comparable to published BEIR results. Only
  before/after deltas on our own fixtures are meaningful. This must be stated
  in the artifacts and README.
- Answer generation or any product metric the harness does not measure
  (e.g. "tokens saved per session").

## Metric semantics we are designing against

Confirmed in `packages/core/src/evaluation/metrics.ts`:

- `recall@k` = fraction of **all** gold paths present in the top *k*. Multi-gold
  queries are therefore strictly harder than single-gold.
- `wrong_source` = for answerable queries, top-1 is not a gold path; for
  unanswerable queries, **any** returned result counts as wrong-source.
- nDCG gain is `2^relevance - 1`, so relevance grades dominate the score.
- `candidate_recall` measures the wider pre-final candidate set — it tells us
  whether a failure is retrieval or ranking.

Because the engine has no abstention threshold today, unanswerable queries will
score ~1.0 wrong-source until effort **B** lands. That is intended: it exposes
the headroom rather than hiding it.

## Design

Three fixtures, each a `(corpus directory, questions.jsonl)` pair. The benchmark
CLI already accepts `--corpus` and `--questions`, so **no harness changes are
required to add a fixture**.

### Fixture 1 — `beir-hotpotqa` (multi-hop)

- Source: BEIR HotpotQA (Wikipedia, multi-hop). 624 MB archive.
- 100 answerable queries, `queryClass: multi_document`. HotpotQA supplies 2
  supporting documents per query, so `recall@k` requires finding both.
- 15 additional unanswerable queries, produced by **excluding** their gold
  documents from the materialized corpus. These are genuinely unanswerable
  against this corpus — real ground truth, not fabricated labels.

### Fixture 2 — `beir-fiqa` (hard semantic)

- Source: BEIR FiQA (real user finance questions). 17 MB archive.
- 50 answerable queries, `queryClass: semantic` — the class where the engine is
  weakest (`ci-hash` recall@1 .200, wrong-source .600).
- 10 unanswerable queries, same exclusion technique.

### Fixture 3 — `wiki-confusables` (domain wrong-source)

Public sets measure ranking rigorously but cannot reproduce Remember's actual
failure mode: two near-identical internal documents where only one is correct.
This fixture is authored, in a **new corpus directory** (`examples/confusable-wiki/`)
so the existing `sample-wiki` baselines stay valid.

- Adjacent / near-duplicate documents: superseded vs current ADR, v1 vs v2
  runbook, staging vs production config, deprecated vs active policy.
- ~30 queries across `ambiguous`, `contradictory`, `multi_document`, and
  `unanswerable`, with graded relevance so nDCG distinguishes "the current
  runbook" (3) from "the superseded one" (1).

### Corpus hardness (critical)

A random sample of distractors would re-saturate the benchmark — with only a few
thousand random Wikipedia articles, any competent embedder trivially separates
the gold documents. Each materialized corpus is therefore:

1. **all gold documents** for the selected queries, plus
2. **lexical hard negatives** — documents mined for term overlap with the
   queries, i.e. plausible-but-wrong sources, plus
3. a **seeded random fill** to a target of ~20,000 documents for topical
   breadth.

Hard negatives are what make `wrong_source` a meaningful number.

### Builder and reproducibility

Mining over a 5.2M-document corpus is a one-time authoring step, not something
every run should repeat. Split accordingly:

- **Committed:** the builder script, `questions.jsonl` per fixture, and
  `selection.json` (the exact document IDs chosen per dataset).
- **Generated and gitignored:** the materialized markdown corpora.
- Rebuild = fetch archive → filter to `selection.json` → write markdown. Fully
  deterministic, so `corpus_hash` reproduces without re-mining.

The walker reads `.gitignore` only *inside* the corpus root
(`packages/core/src/walkers/chokidar.ts`), so a repository-level ignore rule does
**not** cause the generated corpus to be skipped during indexing.

Document paths are corpus-root-relative posix strings, matching
`path.relative(corpusRoot, file)` in the runner.

Relevance mapping: HotpotQA and FiQA qrels are binary (`score = 1`) → relevance
`3`. For graded sources, `score >= 2` → `3`, `score == 1` → `2`.

### Index cache

`benchmark-cmd.ts` currently indexes into a fresh `mkdtemp` on **every** run. At
20,000 documents on the real-embedding profile that is minutes per invocation,
which makes A/B iteration on a reranker impractical.

Add `--index-cache <dir>`: reuse an existing index when `corpus_hash` and
`embedder.modelId` match the cache manifest, otherwise rebuild and rewrite the
manifest. Default behavior (no flag) stays the current throwaway temp index, so
CI is unchanged.

## Data flow

```
BEIR archive (zip, streamed)
  → selection.json (committed doc IDs + query IDs)
  → markdown corpus (generated, gitignored)  ─┐
  → questions.jsonl (committed)              ─┤
                                              ├→ benchmark CLI --corpus/--questions
  examples/confusable-wiki (committed)       ─┘   → index (cached) → hybrid engine
                                                  → EvaluationRun artifact
```

## Testing

- Unit: qrel→relevance mapping, unanswerable construction (gold genuinely
  absent from the corpus), path normalization, selection determinism.
- Unit: index cache hit on matching hash, miss on changed corpus or embedder.
- Validation: every generated fixture loads through the existing
  `loadEvaluationCases` validator, which already enforces "answerable implies
  non-empty relevant" and "unanswerable implies empty relevant".
- Guard: assert each new fixture is **not saturated** on the real-embedding
  profile (recall@5 materially below 1.0), otherwise the fixture failed its
  purpose.

## Risks

- **Subset ≠ leaderboard.** Mitigated by stating it in artifacts and README.
- **Fixtures still saturate.** Mitigated by hard-negative mining and an explicit
  non-saturation check; if it still saturates, raise corpus size or mine harder
  negatives.
- **624 MB download.** One-time, opt-in, never in CI. CI keeps using
  `sample-wiki` + `ci-hash`.
- **Licensing.** Public research datasets are fetched at build time, not
  vendored into the repository.

## Out of scope / follow-on

Effort **A** (cross-encoder reranker) and **B** (wrong-source guard + abstention)
land after this, measured against these fixtures with a ~2 second latency budget
per query.
