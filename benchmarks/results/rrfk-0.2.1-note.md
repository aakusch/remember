# RRF k: 60 → 10 (v0.2.1)

Measured on the **OSS engine as shipped** — no Pro results imported. Both runs use
the committed `remember benchmark` command, `--profile fast` (local BGE
`BAAI/bge-small-en-v1.5`), against the bundled `examples/sample-wiki` corpus and
`benchmarks/retrieval/sample-wiki.questions.jsonl` (30 queries, 25 answerable).

Reproduce:

```bash
remember benchmark --profile fast --rrf-k 60   # before
remember benchmark --profile fast --rrf-k 10   # after (new default)
```

Artifacts: `remember-v0.2.1-fast-local-bge-rrfk60.json`,
`remember-v0.2.1-fast-local-bge-rrfk10.json`.

| metric              | rrfK=60 (before) | rrfK=10 (after) | delta   |
|---------------------|-----------------:|----------------:|:--------|
| recall@1            | 0.640            | 0.660           | +0.020  |
| recall@5            | 0.980            | 0.980           | 0.000   |
| recall@10           | 0.980            | 0.980           | 0.000   |
| candidate recall    | 0.980            | 0.980           | 0.000   |
| MRR                 | 0.980            | 1.000           | +0.020  |
| nDCG@5              | 0.961            | 0.980           | +0.019  |
| nDCG@10             | 0.961            | 0.980           | +0.019  |
| empty-result rate   | 0.000            | 0.000           | 0.000   |
| wrong-source rate   | 0.200            | 0.167           | -0.033  |
| latency p50/p95/max | 6 / 10 / 11 ms   | 6 / 9 / 10 ms   | ~same   |

**Conclusion.** k=10 is better or equal on every metric and worse on none.
recall@5/10 are already saturated on this small corpus, but the top-of-list
quality signals (recall@1, MRR, nDCG) all improve and wrong-source drops. At
these candidate scales the `1/(k+rank)` fusion curve is nearly flat by k=60, so
a smaller k retains more of the per-list rank signal. This matches the finding
on the Pro lineage; the numbers above are the independent OSS confirmation.
