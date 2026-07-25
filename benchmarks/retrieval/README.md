# Retrieval benchmarks

The benchmark fixture is versioned product evidence, not a demo script. Each
JSONL row declares a query, optional intent, query class, answerability, and
graded relevant source paths. The bundled sample corpus covers exact,
semantic, ambiguous, multi-document, contradictory, and unanswerable cases.

## Deterministic CI evaluation

The `ci` profile uses the dependency-free hash embedder. It is intentionally
not semantically meaningful; it provides a stable offline signal for metric,
pipeline, fusion, ordering, fallback, and API regressions:

```bash
pnpm --filter @useremember/core benchmark -- \
  --profile ci \
  --output ../../benchmarks/results/latest-ci.json
```

No network request or model download occurs in this profile. CI quality gates
should compare like-for-like `ci-hash` artifacts and inspect every per-query
regression.

## Release evaluation

The `fast` profile uses the local
`BAAI/bge-small-en-v1.5` embedding model. It may download the model on first
use, so it is an explicit release step rather than a deterministic CI job:

```bash
pnpm --filter @useremember/core benchmark -- \
  --profile fast \
  --output ../../benchmarks/results/release-fast.json \
  --compare ../../benchmarks/results/remember-v0.0.1-local.json
```

Release artifacts may contain aggregate results and public fixture result
paths. Never commit private customer corpora or raw private queries.

## Metrics

The runner reports recall@1/5/10, distinct candidate recall, MRR, nDCG@5/10,
empty-result rate, wrong-source rate, and p50/p95/maximum query latency. Metrics
are also broken down by query class. Unanswerable queries have no recall or
nDCG denominator; returning any source for them counts as a wrong-source
outcome.

The v0.0.1 `ci-hash` and local-BGE baselines use a second query at `candidateK`
because that engine does not expose its pre-final candidates. Final-result
quality and latency still come from the production-shaped `finalK` query.

## Additional fixtures

The bundled `sample-wiki` fixture is **saturated** on the real-embedding profile
(recall@5 `.980`), so it cannot detect a ranking improvement. It remains the
deterministic CI gate and must not be edited — committed baselines pin its
`corpus_hash` and `questions_hash`. Ranking work is measured against the
fixtures below instead.

| Fixture | Corpus | Queries | Dominant class |
|---|---|---|---|
| `sample-wiki` | bundled, 26 docs | 30 | mixed (CI gate) |
| `beir-hotpotqa` | 20k docs, generated | 115 | `multi_document` |
| `beir-fiqa` | 20k docs, generated | 60 | `semantic` |
| `confusable-wiki` | bundled | ~30 | `ambiguous`, `contradictory` |

### Public BEIR subsets

`benchmarks/datasets/beir-fixture.mjs` builds subset fixtures from BEIR. Gold
labels come from the datasets' own relevance judgments, so no hand-labeling is
involved. `selection.json` and `questions.jsonl` are committed; the markdown
corpus is generated and gitignored.

```bash
# One-time authoring step: needs the full archive, streams the whole corpus.
node benchmarks/datasets/beir-fixture.mjs mine \
  --dataset fiqa --archive /path/to/fiqa.zip --out benchmarks/datasets/fiqa

# Reproducible step: materializes the exact committed document set.
node benchmarks/datasets/beir-fixture.mjs build \
  --archive /path/to/fiqa.zip \
  --selection benchmarks/datasets/fiqa/selection.json \
  --out benchmarks/datasets/fiqa/corpus
```

Archives come from the public BEIR distribution
(`https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/<name>.zip`).
They are fetched on demand and never vendored.

Each corpus is all gold documents, plus lexical hard negatives mined for
term overlap with the queries, plus a seeded random fill. The hard negatives are
what keep `wrong_source` meaningful — a purely random distractor pool re-saturates
the benchmark.

**These are subsets, so absolute scores are NOT comparable to published BEIR
leaderboard results.** Only before/after deltas on the same fixture are
meaningful.

Unanswerable cases are built by excluding a query's gold documents from the
materialized corpus, which makes them genuinely unanswerable rather than
synthetically labeled. The engine has no abstention threshold yet, so those
queries currently score ~1.0 wrong-source by design — that is the headroom.

### Confusable documents

`confusable-wiki` targets the failure public benchmarks cannot reproduce: two
near-identical internal documents where only one is correct (superseded vs
current ADR, deprecated vs live runbook, staging vs production config). Graded
relevance separates the current source (`3`) from the plausible-but-stale one
(`1`), so nDCG punishes retrieving the wrong one.

**Read nDCG@5 and per-class wrong-source from this fixture, not recall.** The
corpus is 20 documents, so returning 5 results makes recall nearly free
(recall@5 `.987`, candidate recall `1.000` on the real-embedding profile).
Recall here is saturated by construction and is not a quality signal. The
headroom is in ranking the current document above the stale one — nDCG@5 is
`.745` for `ambiguous` and `.700` for `contradictory` — and in abstention, where
all five `unanswerable` queries still return a source.

## Known ranking limitation (measured 2026-07-24)

Widening the candidate pool reliably improves *reach* and cheaply, but the
ranking stage cannot hold onto it. On `beir-fiqa`, real-embedding profile, with
no reranker:

| candidateK | candidate recall | recall@10 | p95 |
|---|---:|---:|---:|
| 20 | .600 | .490 | 40ms |
| 50 | .720 | **.497** | 44ms |
| 100 | .820 | .467 | 48ms |
| 200 | .890 | .457 | 96ms |

At narrow K the engine is retrieval-limited; at wide K it is ranking-limited,
and badly — K=200 reaches .890 of the gold but delivers .457. **Use
`--candidate-k 50`** as the working point until selection improves; it is where
the two losses balance.

Reading these numbers correctly: `recall@k` is the fraction of *all* gold
documents found, and most FiQA queries have 2–3 gold documents, so it
understates practical usefulness. For the "agent needs one good source" view,
62% of queries surface at least one gold document in the top 10, 54% in the top
5, and 34% at rank 1. Rank-1 quality is the weak spot, which is what
`wrong_source_rate` (.717) measures.

A cross-encoder reranker was tried and did not help — see the commit adding
`createCrossEncoderReranker`. It stays opt-in and off by default.

## Index cache

Embedding a 20k-document corpus takes ~15 minutes on the real-embedding profile,
which makes repeated A/B runs impractical. `--index-cache <dir>` reuses the index
whenever the corpus hash, embedder, and chunker all match:

```bash
pnpm --filter @useremember/core benchmark -- \
  --profile fast \
  --corpus benchmarks/datasets/fiqa/corpus \
  --questions benchmarks/datasets/fiqa/questions.jsonl \
  --index-cache benchmarks/datasets/.index-cache
```

A cache entry is only reusable after the index completes, so an interrupted run
never yields a partial index. Without the flag, behavior is unchanged: a
throwaway index per run.
