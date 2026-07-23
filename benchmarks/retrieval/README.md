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
