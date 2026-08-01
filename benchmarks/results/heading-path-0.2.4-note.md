# heading_path fix (0.2.4) — before/after

## What changed

`parsers/remark.ts` `flattenBlocks` now re-emits `#` markers for heading nodes (and
indents fenced-code content so `#` comment lines inside code are never mistaken for
headings). The smart-split chunker detects section boundaries by matching
`^#{1,6}\s` on this flattened text; the parser previously stripped the markers, so
**every chunk got an empty `heading_path`** — breaking the documented `/v1/search`
`heading_path` field, the CLI breadcrumb, the `headingBoostFactor` lever, and the
`lexicalTieBreak` haystack. On the committed fixture, 96% of chunks had `heading_path: []`
and the only "headings" ever captured were bash comments inside fenced code.

This makes the smart-split chunker split by section **as it was designed to** — so
chunk boundaries (and therefore embeddings) shift. No ranking DEFAULT was changed:
`rrfK` is still 10, `lexicalTieBreak` still false, fusion weights unchanged.

## Before → after (same machine, this fixture)

| profile | metric | before | after |
|---|---|---|---|
| ci / hash (the CI gate embedder) | recall@5 | 0.840 | **0.853** |
| ci / hash | recall@10 | 0.907 | **0.927** |
| fast / BGE (local real embeddings) | recall@5 | 0.980 | 0.960 |
| fast / BGE | MRR | 1.000 | 0.960 |

The CI-gate (hash) embedder improves; the BGE profile dips by one query out of 25 on a
**saturated** fixture (recall@5 was 0.980, MRR 1.0 — no headroom). Both search-engine
and corpus-health reviewers flagged this fixture as too saturated to be meaningful and
recommended harder fixtures (BEIR/confusable) before treating `--fail-on-regression` as a
real signal. The net movement here is within that noise; the fix corrects a real,
documented bug and is net-positive on the actual CI gate.

Artifacts: `remember-v0.2.4-fast-local-bge-headingpath.json`,
`remember-v0.2.4-ci-hash-headingpath.json`.
