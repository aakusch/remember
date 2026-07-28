# Opt-in lexical-overlap tie-breaker (measurement)

Measured on the **OSS engine as shipped** — no Pro results imported. Both runs
use the committed `remember benchmark` command, `--profile fast` (local BGE
`BAAI/bge-small-en-v1.5`), against the bundled `examples/sample-wiki` corpus and
`benchmarks/retrieval/sample-wiki.questions.jsonl` (30 queries, 25 answerable).

The tie-breaker (`HybridSearchOptions.lexicalTieBreak`, **OFF by default**)
reorders only runs of exactly-equal fused RRF score by lexical-overlap density
(fraction of distinct query terms present in a hit's text, then term
frequency). It never reorders candidates whose fused scores differ, and does
not touch `rrfK` or the fusion weights.

Reproduce:

```bash
remember benchmark --profile fast                      # default (flag off)
remember benchmark --profile fast --lexical-tiebreak   # opt-in
```

Artifacts: `remember-v0.2.3-fast-local-bge-rrfk10.json` (off),
`remember-v0.2.3-fast-local-bge-lexical-tiebreak.json` (on).

| metric              | flag off (default) | flag on | delta   |
|---------------------|-------------------:|--------:|:--------|
| recall@1            | 0.660              | 0.660   | 0.000   |
| recall@5            | 0.980              | 0.980   | 0.000   |
| recall@10           | 0.980              | 0.980   | 0.000   |
| candidate recall    | 0.980              | 0.980   | 0.000   |
| MRR                 | 1.000              | 1.000   | 0.000   |
| nDCG@5              | 0.983              | 0.992   | +0.008  |
| nDCG@10             | 0.983              | 0.992   | +0.008  |
| empty-result rate   | 0.000              | 0.000   | 0.000   |
| wrong-source rate   | 0.167              | 0.167   | 0.000   |
| latency p50/p95/max | 7 / 11 / 12 ms     | 7 / 11 / 11 ms | ~same |

**What changed.** Flag on reordered 4 tie cases; all metric movement is in
ranking quality, none in recall or wrong-source:

- `contradictory-rollback-fix-forward` — nDCG@5 0.983 → 1.000 (the
  graded-relevant `deploy.md` surfaced above a tied non-relevant hit).
- `multi-onboarding-wiki` — nDCG@5 0.708 → 0.893 (`getting-started.md`,
  relevance 3, moved ahead of `README.md`, relevance 1).
- `contradictory-typescript-exceptions`, `multi-deploy-rollback` — neutral
  re-orderings of tied non-graded candidates (no metric change).

**Default-off is byte-for-byte the baseline.** With the flag off the fused
result orderings are identical to the pre-change engine on every query
(verified by diffing `cases[].result_paths`), and on the deterministic
`ci`/hash profile the flag is completely inert (0 ranking changes, identical
summary). A unit test also asserts flag-off === default engine.

**Conclusion / recommendation.** On this corpus the tie-breaker is a strict
ranking-quality win (nDCG up, recall/MRR/wrong-source flat, latency flat) with
no measured downside. But recall@5 is already **saturated at 0.980** here, so
the recall headroom the signal was designed for (unsaturated BEIR/confusable
fixtures) cannot be demonstrated on the bundled corpus. **Keep it opt-in**
until it can be measured against unsaturated hard fixtures; a +0.008 nDCG lift
on a saturated benchmark is not sufficient evidence to flip the default.
