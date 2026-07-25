# Retrieval engine: lessons learned and request for holistic review

Written 2026-07-25, after a concentrated push on `feat/retrieval-eval-expansion`
(8 commits, `03de2d1..331bce1`). Audience: a reviewer who did not do this work.

The engine improved measurably. It is also not yet a product, several of its
best-looking numbers rest on fixtures we designed ourselves, and the people who
built it have been staring at it too long. This document exists to hand a
reviewer everything needed to disagree with us productively.

---

## 1. What changed, with evidence

All figures from committed artifacts in `benchmarks/results/`, real-embedding
profile (`BAAI/bge-small-en-v1.5`) unless stated.

| Change | Effect | Commit |
|---|---|---|
| New eval fixtures (BEIR subsets + authored confusables) | Unsaturated the benchmark: previous fixture sat at recall@5 `.980` before *and* after a ranking change | `d5fd5ec` |
| Benchmark index cache | 15 min → seconds for repeat runs; made A/B iteration possible at all | `e7fbfbd` |
| `rrfK` default 60 → 10 | sample-wiki MRR `.980`→`1.000`, wrong-source `.200`→`.167`; hotpotqa recall@10 `.840`→`.855`; fiqa recall@10 `.497`→`.520` | `38f9126` |
| Parser preserves heading structure | `heading_path` was empty for **every chunk in every index** (verified 121/121). Chunking had degraded to fixed-size slicing that ignored sections | `0828b7e` |
| `applyStatusDemotion` | confusable-wiki rank-1 correct `42%`→`92%`, rank-1 stale `54%`→`8%`, nDCG@5 `.815`→`.973` | `0828b7e` |
| Cross-encoder reranker | **Negative result.** Kept opt-in, default off | `3da0b63` |

Current headline, structured markdown corpora, `candidateK=100`:

| Docs | ≥1 correct doc in top-5 | top-10 | top-25 | p95 |
|---:|---:|---:|---:|---:|
| 1,000 | 100% | 100% | 100% | 20 ms |
| 5,000 | 99% | 100% | 100% | 22 ms |
| 10,000 | 99% | 99% | 100% | 30 ms |

---

## 2. Lessons learned

**A saturated benchmark makes every change unfalsifiable.** The bundled 30-query
fixture scored recall@5 `.980` both before and after a substantial ranking
rework. Nobody could tell whether that rework helped. Fixing the *measurement*
before touching the engine was the highest-leverage decision in the whole push,
and it should have happened before the previous rework, not after.

**We optimised before locating the loss.** A cross-encoder reranker was built
first because reranking is the obvious lever. Then measurement showed that at
`candidateK=20`, 41.5% of correct documents were never retrieved at all — so
reranking's entire reachable headroom was ~`.095`. Two models later it was still
net-negative. The lesson is cheap and repeatable: *attribute the loss per stage
before building anything.* Counting where the 94 correct documents actually died
took ten minutes and would have redirected a day of work:

| Stage | Correct docs lost | Share |
|---|---:|---:|
| Never retrieved (missed the candidate pool) | 39 | 41.5% |
| Retrieved, then lost during ranking | 10 | 10.6% |
| Survived to top-10 | 45 | 47.9% |

**Negative results are worth committing.** Three plausible ideas were refuted:
cross-encoder reranking (two different models), normalized weighted score fusion
(loses to rank-based RRF), and CLS pooling (a wash — and candidate recall
actually dropped `.720`→`.703`). All are recorded with numbers so nobody
re-litigates them from intuition. `3da0b63` is deliberately a commit whose
message says "this does not work."

**Silent feature death is the dominant failure mode, not regression.** Four
shipped features were doing nothing: `heading_path` was empty everywhere,
`applyHeadingBoost` therefore inert, the query planner passthrough, the reranker
passthrough. `intent` is accepted by the public API, threaded through core,
recorded in traces — and consumed by nothing. Nothing failed loudly. Tests
passed.

**Unit tests that bypass real adapter wiring hide integration bugs.**
`tests/chunker.test.ts` fed raw markdown straight to the chunker and passed,
while the actual pipeline handed the chunker heading-stripped text from the
parser. The test proved the chunker worked on input it never receives in
production. The new `tests/parser-heading-structure.test.ts` asserts
parser→chunker end to end instead.

**Cache keys must cover everything that changes the output.** The benchmark index
cache keyed on corpus + embedder + chunker options. A parser fix changes indexed
text but none of those, so the fix would have silently reused old-pipeline
indexes and reported no change. `PIPELINE_REV` now covers it. This class of bug
produces confident wrong measurements, which is worse than a crash.

**Defaults inherited from papers can be wrong for your scale.** `rrfK=60` comes
from TREC-scale runs of thousands of results. At `candidateK ≤ 200` it is nearly
flat: rank 1 scores `0.5/61` against rank 20's `0.5/80`, only 1.3× apart, which
erases the top-rank signal it exists to preserve.

**The metric you report changes the verdict.** `recall@k` counts the fraction of
*all* correct documents, and most FiQA questions have 2–3, so it understated
usefulness badly. The metric that matches how an agent consumes results — "is at
least one correct document in the returned set" — moved the same engine from
"recall@10 = .490" to "62% of questions answerable from the top 10." Neither
number is wrong; only one answers the product question.

**Corpus structure outweighs corpus size.** Identical engine, identical 20,000
documents: titled Wikipedia-style docs scored 98% top-10, untitled forum posts
66%. A 32-point swing from document shape alone. This is why an authoring
standard is engine work, not documentation busywork.

**Sometimes the fix is already in the data.** Of 8 stale documents that beat the
correct answer, 7 already declared `status: superseded|deprecated|archived|
draft|rejected` and 5 carried a `superseded_by` pointer. No detector, no model,
no new authoring burden was needed — the engine simply never read what was
already there. We nearly built a supersession *detector* first, which would have
improved that measurement by exactly zero.

**Small fixtures produce noise, and we nearly over-read it.** On 25–31 query
fixtures a `.08` swing is one or two queries. The heading fix looks like a
regression on sample-wiki (rank-1 `.660`→`.580`) and a clear win on confusables
(nDCG@5 `.819`→`.885`). Both are within noise. We are not claiming either.

---

## 3. What we do not trust about our own results

Read this section before believing section 1.

1. **The confusables fixture is partly self-fulfilling.** We specified it, and we
   specified that documents declare clean `status` frontmatter. Status demotion
   then scores extremely well on it. The 54%→8% improvement is real *for corpora
   that label lifecycle state*, which real wikis often do not. **Ask: does this
   generalise, and what does it do on a corpus with no `status` fields at all?**
2. **BEIR subsets are not leaderboard-comparable.** We materialise a subset with
   mined hard negatives, so absolute scores mean nothing outside our own
   before/after comparisons. We believe we've said so everywhere; check we have.
3. **The "98% at 10k docs" claim rests on Wikipedia-shaped documents.** It may be
   optimistic for a messy internal wiki full of near-duplicate meeting notes,
   and it is definitely optimistic for untitled content (66%).
4. **One fixture, 50–115 queries, one embedding model.** The *shape* of the
   scaling curve we trust; individual cells are roughly ±.05.
5. **The 100k-document row was extrapolated, never measured.**
6. **Latency numbers come from a benchmark that queries twice per case** (once
   for results, once for a wider candidate probe), so they are pessimistic —
   but they were also all measured on one machine with nothing else running.

---

## 4. Known gaps blocking productization

| Gap | State | Why it matters |
|---|---|---|
| **No abstention** | Engine returns confident results for questions with no answer in the corpus, 100% of the time | An agent cannot distinguish "here is your answer" from "here is the closest thing I had." This is the single worst product defect. |
| **`intent` is inert** | Accepted by API, threaded through core, consumed by nothing | Either make it route retrieval or remove it from the public surface. Shipping a parameter that does nothing is a trap for callers. |
| **Query planner passthrough** | Seam exists, unimplemented | Query expansion is the main untried lever on retrieval *reach*, which is the binding constraint at scale. |
| **Status demotion defaults off** | Live but opt-in | Our biggest measured win is not on by default. Deliberate (unproven generalisation), but revisit. |
| **`rrfK` default changed** | `0.1.0` is published to npm with `rrfK=60` | Behaviour change for every consumer; needs a minor bump before release. |
| **Baselines not regenerated** | Committed v0.1.0 artifacts predate the new default | Regeneration was started and interrupted. `--fail-on-regression` compares against stale references. |
| **`sqlite-vec` is a linear scan** | `vec0` KNN is exhaustive, no ANN index | Fine to ~100k. A wall somewhere past 500k–1M. |
| **Confidence signal unverified** | Not built | Needed for both abstention and adaptive result counts; we have not checked whether score margin actually predicts a miss. |
| **Cloud not revisited** | remember-cloud consumes core `0.1.0` | None of this session's changes have been evaluated against the hosted API, metering, or `fast|enhanced` modes. |
| **Maintainer subsystem** | Designed only (`docs/superpowers/specs/2026-07-25-knowledge-base-maintainer-design.md`) | Not built. |

---

## 5. What we are asking a reviewer to do

Please be adversarial. We would rather hear "your headline number is
misleading" now than after someone quotes it publicly.

**Highest value questions, roughly in order:**

1. **Is our headline claim honest?** We want to say: *"finds the right document in
   the top 10 at least 99% of the time for corpora up to 10,000 documents, in
   ~30 ms."* Is that defensible given §3? What qualifier is missing? What would
   you refuse to say?
2. **Is "at least one correct doc in the returned set" the right product metric?**
   It is the metric an agent consumer needs, and it flatters us relative to
   `recall@k`. Are we grading ourselves generously?
3. **Attack the fixtures.** Where are they unrepresentative of a real team wiki?
   What query class is missing entirely? (We know we have no true multi-hop
   coverage on wiki-shaped content, and no queries about content that changed
   over time.)
4. **Abstention design.** Given no scoring stage produces calibrated confidence,
   what is the cheapest honest mechanism for "the answer isn't here"? We have 30
   labelled unanswerable queries to test against.
5. **Should `intent` live or die?** Argue it either way. If it lives, is a closed
   enum (`lookup | concept | procedure | decision | definition`) the right shape,
   and should the calling agent supply it or should the engine infer it?
6. **Where is the next real win?** Our belief: retrieval *reach* (query
   expansion), not ranking, because at wide candidate pools the ceiling binds
   before ranking does. Tell us if that reasoning is wrong.
7. **Is the API surface right for an AI consumer?** `k` is clamped 1–50, snippets
   are ~280 chars, `frontmatter` is returned in full. What would you add or
   remove for an agent that must decide *without* loading whole documents?
8. **Productization holes we have not thought of.** Ops, failure modes,
   multi-tenancy, index rebuild cost, upgrade path when chunking changes (every
   chunking change invalidates every index — we have no migration story).

**Where to start reading:** `docs/architecture.md` for the shape,
`packages/core/src/search/hybrid.ts` for the whole query path in one file,
`benchmarks/retrieval/README.md` for what each fixture measures and its known
limits, then `benchmarks/results/` for raw artifacts.

**How to reproduce anything here:** every number is a committed artifact. The
benchmark takes `--corpus`, `--questions`, `--profile ci|fast`, `--candidate-k`,
`--k`, `--rrf-k`, `--bm25-weight`, `--vector-weight`, `--status-demotion`,
`--reranker`, `--index-cache`, `--compare`, `--fail-on-regression`. Use
`--index-cache` or you will re-embed for 15 minutes per fixture.

One trap worth passing on: do not pass flags via an unquoted shell variable in
zsh. It does not word-split, the whole string arrives as one bogus argument, the
run dies, and a `grep` on the output will hide it.
