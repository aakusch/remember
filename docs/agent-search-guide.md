# Agent search guide

Status: usage contract for an AI agent calling `remember` search. Written for the
goal "get high-confidence evidence with snippets I can read, without reading the
whole corpus." Numbers come from the 2026-07 measurements in
[`benchmarks/retrieval/README.md`](../benchmarks/retrieval/README.md).

## The surface

```
GET /v1/search?q=<query>&k=10&intent=<purpose>&mode=fast&debug=0
GET /v1/pages/<path>?format=text          # read one document in full
GET /v1/pages?filter[status]=current      # frontmatter-filtered listing
```

| Fact | Value |
|---|---|
| `k` range over HTTP | clamped to 1–50 (`k=10` default) |
| Results per page | one chunk per document by default (page dedup + backfill) |
| Snippet size | ~280 characters, selected to cover your query terms |
| Result fields | `path`, `title`, `snippet`, `score`, `frontmatter`, `heading_path`, `retrievers`, `chunk_id` (`<path>#<idx>`) |
| Latency | p95 18–49 ms at 1k–20k documents |

Latency is not your constraint and neither is snippet volume: `k=25` is roughly
7 KB of text. **Search wide, read narrow.** The expensive operation is fetching
full pages, so use breadth in search to avoid guessing which page to fetch.

## Choosing `k`

| Situation | `k` | Rationale |
|---|---:|---|
| Exact known identifier, filename, or error string | 3–5 | If it is there, it is at the top. Extra results are noise. |
| Specific question, distinctive terms | 10 | Default. |
| Vague, conceptual, or "where is X documented" | 20–25 | Breadth buys recall when the query is weak. |
| Confirming a document does *not* exist | 25 | Absence is only credible after a wide look. |
| Anything | >25 | Not useful — see below. |

Measured basis, hard corpus at 10,000 documents ("at least one correct document
in the returned set"):

| Returned set | Hit rate |
|---:|---:|
| top-5 | 66% |
| top-25 | 80% |

Widening from 5 to 25 recovers 14 points for ~5 KB of extra snippets. But this
curve flattens: the engine is *ranking*-limited, not reach-limited, once the
candidate pool is wide (widening the internal candidate pool to 200 reaches 89%
of gold documents while delivering 46% — see the "Known ranking limitation"
section of the benchmark README). Past `k=25`, reformulate the query instead of
asking for more results.

## Query formulation

| Works | Fails |
|---|---|
| Specific entities: `ADR-011 refresh token rotation` | One vague word: `performance` |
| Distinctive phrasing lifted from the domain: `secret rotation cadence Vault` | Generic phrasing: `how do we handle things` |
| Named systems, error strings, function names, ticket IDs | Questions whose answer requires combining two documents |
| The words a document's author would have used | The words *you* would use if you had never read the corpus |
| Terms that would appear in a heading or title | Pronouns and abstractions: `the new approach` |

Rules:

1. **Prefer the domain's vocabulary over natural-language question form.** The
   retriever matches text; it does not parse questions.
2. **One question per query.** Multi-hop questions ("which runbook did the ADR
   that replaced Redis sessions change?") need two documents combined. That is
   the fixture class where the engine is weakest — issue two queries and join the
   results yourself.
3. **Reformulate rather than paginate.** If the top 10 are all off-topic, a
   different query beats a bigger `k`. Pull a distinctive term out of the best
   near-miss snippet and search again with it.
4. **Do not pass an empty or whitespace query** — it returns an empty result set.

## When to trust result #1

| Corpus shape | Rank-1 wrong |
|---|---:|
| Titled, one-topic-per-document (`beir-hotpotqa`, 1k) | ~17% |
| Untitled, overlapping topics (`beir-fiqa`, 10k) | ~70% |

On a hard corpus the top result is wrong roughly 70% of the time. On a clean,
well-structured corpus it is right most of the time. You usually do not know
which kind of corpus you are pointed at.

Working rules:

- **Read 3–5 snippets before concluding anything.** Not one.
- **Require corroboration for anything consequential.** Two independent
  documents agreeing, or one document you fetched in full.
- **Do not read `score` as confidence.** It is a fused rank score, not a
  calibrated probability. It is comparable *within* one result set and
  meaningless across queries.
- Useful unmeasured heuristics: `retrievers: ["bm25","vector"]` (found by both
  arms) is a better sign than a vector-only hit; a snippet that does not contain
  your distinctive query term was probably retrieved on loose semantic
  similarity; results scattered across unrelated paths with flat scores mean the
  engine found nothing in particular.
- Escalate deliberately: snippets → `GET /v1/pages/<path>?format=text` for the
  one or two documents that actually look right. Never fetch the whole result
  set in full.

## Check staleness yourself

The engine has **no notion of authority or recency**. On a fixture of deliberately
confusable documents (superseded vs current ADR, deprecated vs live runbook) it
puts a stale document at rank 1 on 54% of queries — more often than the correct
one (42%).

`SearchResult.frontmatter` is returned on every result, so you can do what the
ranker does not:

1. Read `frontmatter.status` before citing. Prefer `current`.
2. If `status` is `superseded` or `deprecated`, follow `frontmatter.superseded_by`
   and cite that document instead.
3. If two results conflict, prefer the one with the later `frontmatter.date` and
   say in your answer that a conflict existed.
4. To restrict a survey to live documents up front, use the listing API:
   `GET /v1/pages?filter[status]=current&sort=-date`.
5. If `status` is missing entirely, treat the document as unverified — say so
   rather than presenting it as current policy.

See [`authoring-for-retrieval.md`](./authoring-for-retrieval.md) for the
frontmatter contract this depends on.

## Recognizing "the answer isn't here"

**The engine has no abstention.** Measured empty-result rate is 0.0. On
benchmark queries whose correct documents were deliberately removed from the
corpus, it returned confident-looking results on 100% of them. Every
unanswerable query still gets a ranked list with plausible snippets and normal
scores.

> Results being returned is not evidence that an answer exists. It only means
> the corpus contains text.

There is no threshold to check, so use the evidence itself:

| Signal | Reading |
|---|---|
| No snippet contains your distinctive term (entity, ID, filename) | The corpus does not discuss the specific thing you asked about |
| Results span unrelated topics with no common thread | Nothing matched; you are seeing the corpus's general shape |
| Snippets are topically adjacent but never state the fact | Related pages exist; your answer does not |
| A reformulated query returns a completely different, equally weak set | No stable match exists |
| Scores are flat across all `k` results | No result distinguished itself |

Procedure:

1. Query. Read snippets.
2. If no snippet states the fact, reformulate once with terms taken from the
   closest near-miss.
3. If the second attempt is also weak, widen to `k=25` once.
4. Then stop and report absence: what you searched, what the closest documents
   were (with paths), and that the corpus does not answer it.

Reporting "not in the corpus, closest is `engineering/runbooks/secret-rotation.md`"
is a correct and useful answer. Assembling one from a weak match is a fabrication
that reads exactly like a real answer.

## `intent`

Pass `intent` on every search. It is a short statement of purpose, not corpus
text:

```
GET /v1/search?q=performance&intent=web+latency+and+Core+Web+Vitals&k=20
```

**Be clear about what this does today: nothing.** `QueryInput.intent` exists
end-to-end in core and the cloud API, is normalized, and is threaded to the query
planner and reranker — both of which are deterministic passthrough by default.
No stage consumes it, and results are identical with and without it. It is
reserved for future routing, expansion, and snippet selection. Pass it so
callers are already correct when it becomes live; do not expect it to change
results, and never explain a result by reference to it.

Same for `mode=enhanced`: the seam exists, the shipped reranker is passthrough.

## Budgeting your own context

| Do | Instead of |
|---|---|
| One search at `k=20`, read snippets, fetch 1–2 pages | Ten searches at `k=5` |
| `GET /v1/pages/<path>?format=text` for the one page that matters | Fetching every path in the result set |
| `GET /v1/pages?filter[...]` for structured surveys ("all current runbooks") | Searching repeatedly to enumerate |
| Cite `chunk_id` (`<path>#<idx>`) so a claim is traceable | Paraphrasing without a path |
| `debug=1` only while diagnosing bad retrieval | Requesting traces by default — the trace is large |

## Checklist

1. Distinctive terms, one question, `intent` attached.
2. `k` = 3–5 exact / 10 default / 20–25 vague.
3. Read 3–5 snippets. Never conclude from rank 1 alone.
4. Check `frontmatter.status` and `date` before citing; follow `superseded_by`.
5. Fetch full text for the 1–2 pages that matter.
6. No snippet states the fact? Reformulate once, widen once, then report absence.
