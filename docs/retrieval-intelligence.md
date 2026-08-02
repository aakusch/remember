# Search engine and retrieval intelligence roadmap

Status: Phase 1 deterministic retrieval foundation implemented; optional
model-backed reranking remains gated by evaluation.

## Product principle

Remember's core value is retrieval efficiency: finding more useful evidence in
fewer results, with less latency and less downstream agent context. The
database, embedding provider, and individual ranking algorithms are
replaceable components.

The defensible system is:

```text
query
  → evaluated candidate generation
  → calibrated fusion and reranking
  → bounded evidence package
  → optional cited Answer
  → outcome feedback
```

Remember's retrieval engine remains useful without a language model:

```text
query → BM25 + vector retrieval → RRF fusion → ranked, source-cited passages
```

Optional intelligence should improve this pipeline, not replace it with a
large prompt over the knowledge base:

```text
query + intent
      → local or remote query expansion
      → parallel lexical + vector retrieval
      → RRF with original-query weighting
      → bounded reranking
      → ranked, source-cited passages
```

Cloud deployments may add answer synthesis after retrieval. The OSS engine's
primary contract remains inspectable evidence so downstream agents can choose
whether and how to generate.

## v0.0.1 baseline limitations

The recorded v0.0.1 pipeline is the benchmark baseline:

- configured BM25/vector weights are not yet applied by fusion;
- fusion truncates before boosts, deduplication, and reranking;
- BM25 is not yet overlapped with the embedding/vector branch;
- page deduplication can return fewer distinct pages than requested; and
- the implemented reranker is passthrough.

v0.1 corrects the weights, candidate window, stage ordering, page backfill,
and BM25/embedding overlap. The implemented planner and reranker remain
passthrough, and model-backed candidates remain unpromoted until they clear
the benchmark gates.

## Why keep the layers separate

- Keyword and vector indexes locate evidence efficiently across large corpora.
- Exact matches remain stable when a model is unavailable.
- A small reranker can judge tens of candidates instead of reading every page.
- Users can run the engine offline with no provider bill.
- Connected agents can use raw passages without paying twice for generation.
- Cloud can prepare a cited answer once instead of every agent independently
  spending context to interpret the same passages.

## Planned core interfaces

The first implementation should extend existing adapters rather than create a
parallel search engine.

### Query planner

```ts
interface QueryPlanner {
  plan(input: {
    query: string;
    intent?: string;
  }): Promise<{
    lexical: string[];
    semantic: string[];
    hypothetical?: string[];
  }>;
}
```

The default planner is passthrough and makes no model call. Optional planners
may use a local model or a provider adapter.

### Reranker

The existing `Reranker` interface remains the insertion point. Planned
implementations include:

- a local cross-encoder;
- a local small language model;
- a remote provider adapter; and
- passthrough for offline, fastest, or fallback behavior.

Reranking must receive a bounded, deduplicated candidate set. Retrieval scores
and strong exact matches should be blended with the reranker rather than
discarded.

### Intent

An optional intent string gives the caller enough context to disambiguate a
short query without itself becoming searchable content:

```json
{
  "query": "performance",
  "intent": "web latency and Core Web Vitals"
}
```

Intent may influence expansion, reranking, and snippet selection.

## Local model posture

The OSS edition should support fully local enhancement when practical:

- small embedding model;
- small query-expansion model;
- small cross-encoder or reranking model; and
- explicit opt-in downloads with size and hardware requirements shown first.

The basic install must not silently download multi-gigabyte models or require a
GPU. Model absence and failure must fall back to deterministic search.

## Cloud answer layer

The managed product may add a separate `remember_answer` surface that:

1. invokes the core retrieval pipeline;
2. packs a small authorized evidence set;
3. asks an allowlisted model to answer only from those sources;
4. validates citations against supplied source IDs; and
5. returns `insufficient_evidence` rather than guessing.

Answer generation, provider routing, commercial metering, and organization
policy live in the separate hosted Cloud product. Reusable query-planning,
reranking, evaluation, and citation types belong in the MIT core where they
benefit local and hosted users alike.

## Evaluation

Every search change should be evaluated against a versioned fixture containing:

- the question;
- optional intent;
- expected relevant paths or chunks;
- whether the corpus can answer;
- query class (exact, semantic, ambiguous, multi-document, contradictory);
  and
- stable corpus version.

Report recall@k, MRR, nDCG, latency, and model cost where applicable. Answer
layers additionally report citation validity and unsupported-claim rate.

The repository should gain a benchmark command before model-backed ranking
becomes the default.

### Versioned baseline

The repository now includes a 30-query sample-wiki fixture and an offline
`ci-hash` runner. Its v0.0.1 baseline lives at
`benchmarks/results/remember-v0.0.1-ci-hash.json`. The release baseline at
`benchmarks/results/remember-v0.0.1-local.json` uses local
`BAAI/bge-small-en-v1.5` embeddings. Artifact metadata identifies the corpus,
questions, engine profile, and embedder by stable hashes, keeping deterministic
CI regression separate from representative release evaluation.

### Running it

The harness reports recall@k, candidate recall, MRR, nDCG, wrong-source and
empty-result rates, latency percentiles, and per-class breakdowns for whatever
corpus you point it at. Formal, published benchmark numbers for the shipped
0.3.0 engine are not yet available — the shipped engine is untuned (the default
fusion and ranking are deliberately simple), so run the harness against a corpus
you care about rather than relying on a single headline figure. No model-backed
reranker has cleared a promotion gate, so 0.2.0 ships passthrough as the only
reranker.

## Privacy and safety

- Retrieved documents are untrusted data, not model instructions.
- Local-model features remain local.
- Remote-provider adapters require explicit configuration.
- Provider dispatch sends only the bounded passages required for the request.
- Hidden chain-of-thought is never stored or returned.
- Debug output may explain retrieval and scoring signals, not private model
  reasoning.

## Rollout

Search quality leads the product. The open-source engine delivers that quality
through the CLI and the agent HTTP API; a human browser surface (viewer/editor)
is a **Pro** concern and is developed separately, not in this repository.

### Phase 1 — competitive retrieval foundation

1. Create a versioned benchmark fixture and baseline current hybrid retrieval.
2. Correct candidate limits, configured weights, pipeline ordering, page
   backfill, and retrieval-stage overlap.
3. Add optional intent and a passthrough query-planner interface.
4. Add structured ranking traces.
5. Evaluate a bounded local or remote reranker behind configuration.
6. Define the evidence-package contract required by Answer composition.
7. Publish quality, latency, context, and resource comparisons.

### Phase 2 — human retrieval surface (Pro)

A browser workspace over this same retrieval core — information architecture,
guided onboarding, and a Search UI built on the stable Phase 1 evidence and
trace contracts — is a **Pro** deliverable, developed outside this repository.
The open-source engine's contract is the CLI and the agent HTTP API; those stay
first-class regardless of what any UI adds on top.

### Phase 3 — Answer composition in Cloud

1. Pack the smallest useful authorized evidence set.
2. Add adjacent-chunk retrieval without bypassing access controls.
3. Generate a bounded Answer with structured source IDs.
4. Validate citations server-side and abstain on insufficient evidence.
5. Add provider fallback, budgets, idempotency, and feedback.

### Phase 4 — feedback and provenance

1. Link retrieval and Answer events to resulting agent artifacts.
2. Measure useful, wrong-source, incomplete, stale, and unsupported outcomes.
3. Use accepted feedback to improve evaluation, ranking, and corpus proposals.

The hosted answer, provider-routing, and billing layer belongs to the separate
Cloud product and is out of scope for this open-source engine.
