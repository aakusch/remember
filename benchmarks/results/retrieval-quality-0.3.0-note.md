# Retrieval-quality fixes (0.3.0) — heading_path + chunk-size

Two ranking-adjacent correctness fixes, done together, with the CI gate re-baselined
to the new (correct) behavior. Approved as a deliberate quality change.

## What changed

1. **`heading_path` now populates.** `parsers/remark.ts` re-emits `#` markers for
   heading nodes (and indents fenced-code content so `#` comments inside code can't
   masquerade as headings). Previously every chunk got `heading_path: []` while
   code-fence comments hallucinated headings — so the documented `/v1/search`
   `heading_path` field, the `headingBoostFactor` lever, the tie-break haystack, and
   the CLI breadcrumb were all inert or misfiring. Section-aware chunking now works
   as designed, and doctor's `no-structure` / `wall-of-prose` checks are re-enabled.

2. **Chunk size fits the embedder's window.** The chunker's default size was a flat
   900 tokens, but the default embedder (`bge-small`) truncates at **512** — so a
   900-token chunk's vector was silently built from only its first ~512 tokens while
   FTS stored the full text (the vector and lexical arms saw *different* documents).
   The chunk size is now the embedder's `maxInputTokens` (new interface field) capped
   at 85% for overlap/heading headroom: **bge → 435, OpenAI → 512**, hash → 512.

Both change chunk boundaries, so retrieval ranking moves.

## Before (0.0.1 baseline) → after (0.3.0)

| profile | recall@5 | MRR | semantic recall@5 |
|---|---|---|---|
| **fast / BGE** (real embeddings) | 0.980 | 1.000 | 1.000 |
| **fast / BGE — after** | 0.960 | 0.960 | **1.000** |
| ci / hash (the CI proxy) | 0.787* | — | 0.900* |
| ci / hash — after | **0.853** | 0.853 | 0.700 |

\* the old committed v0.0.1 baseline.

**On the real embedder, semantic recall is perfect (1.0)** and overall recall stays
strong (0.96). On the CI **hash** proxy, overall recall@5 *improves* (+0.067) but the
per-class "semantic recall" drops to 0.70 — expected, because the hash embedder is not
semantically meaningful, so its score on semantic-labeled queries is noise. The CI gate
is a deterministic regression tripwire, not a quality measurement (every quality claim
cites the fast/BGE runs), so it is re-baselined to `remember-v0.3.0-ci-hash.json`.

Artifacts: `remember-v0.3.0-fast-local-bge.json`, `remember-v0.3.0-ci-hash.json`.
The fixture is unchanged (per the repo CLAUDE.md); only the results baseline moved.
