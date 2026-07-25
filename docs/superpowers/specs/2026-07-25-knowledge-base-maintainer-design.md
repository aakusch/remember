# Knowledge base maintainer (Phase M) — design

Status: proposed 2026-07-25
Scope: design only. No implementation, no engine changes in this document.
Depends on: [`2026-07-24-retrieval-eval-expansion-design.md`](./2026-07-24-retrieval-eval-expansion-design.md)

## Problem

The retrieval engine is now measured well enough to see that its largest quality
losses are **not in the ranking code**. They are in the corpus.

Measured this week, all on the real-embedding profile
(`BAAI/bge-small-en-v1.5`), reproduced from committed artifacts in
`benchmarks/results/`:

| Finding | Evidence | Number |
|---|---|---:|
| Document structure dominates quality | `hotpot-*` (every doc titled) vs `fiqa-*` (untitled forum posts), both 20k docs, same engine | hit@10 `.980` vs `.660` |
| The engine ranks stale documents first | `remember-v0.1.0-confusable-fast-local-bge.json`, 26 answerable queries | superseded doc at rank 1 on **14/26 (53.8%)**, correct doc on 11/26 (42.3%) |
| No abstention | 5 `unanswerable` queries in `confusable-wiki`, 25 in the BEIR fixtures | wrong-source `1.000` |
| Quality decays with corpus size on hard corpora | `scratch-hit-{1000,5000,10000,20000}.json`, fiqa | hit@10 `.900 → .820 → .700 → .660` |

Two of these are unreachable by better relevance ranking. The 32-point
structure gap is a property of the documents, not the retriever. The
stale-first failure is not a relevance error at all — both documents in each
confusable pair genuinely *are* topically relevant, and the engine has no notion
of authority or recency with which to break the tie.

The uncomfortable detail that shapes this entire design: **the metadata needed
to break those ties already exists in the documents.** Of the 14 documents that
took rank 1 while being the stale member of their pair:

- 13/14 already declare a non-`current` `status` in frontmatter
  (`superseded`, `deprecated`, `archived`, `draft`, `rejected`);
- 8/14 already declare `superseded_by`;
- 1/14 (`config/staging-api-config.md`, `status: current`) is not stale at all —
  it is a *facet* confusion between two live documents.

So a maintainer that only detects supersession would have found almost nothing
new in the corpus where we measured the failure. The failure is that nothing
*consumes* the authority metadata. This has a direct consequence for phasing
(see [Phasing](#phasing)) and for how honest we are allowed to be about what
this subsystem buys.

The current mitigation for both failures is documentation telling the *calling
agent* to compensate — [`docs/agent-search-guide.md`](../../agent-search-guide.md)
has sections titled "Check staleness yourself" and "Recognizing 'the answer isn't
here'". That is the right short-term move and the wrong long-term contract: it
pushes authority checking and abstention onto every consumer, and it only works
when the metadata it tells them to read is present and consistent. Making it
present and consistent is this subsystem's job.

`SearchResult.frontmatter` is already populated on every result
(`stores/sqlite-vec.ts` → `getFrontmatter`). `EvidencePackage.conflicts` and
`EvidencePackage.gaps` already exist in `types.ts` and are constructed but never
populated by anything (`search/evidence.ts` fills them only from caller-supplied
options). Latency headroom is large: p95 is under 50 ms against a ~2 s budget.

## What the maintainer is

A **health layer around the engine**, not a ranking component. Its job is
keeping the corpus retrievable over time. It answers three questions the engine
cannot:

1. Will this document retrieve badly? (structure)
2. Which of these two similar documents should win, and who says so? (authority)
3. What does the corpus not cover? (gaps)

It is a set of **detectors** producing **findings**. It never decides ranking,
never generates content, and never edits a team's documents without a human
approving the specific diff.

### Safety invariants

These are hard constraints, not preferences. Every capability below is designed
inside them.

1. **No maintainer code path writes to `content/` without an explicit,
   separately invoked, human-approved apply step.** Detection and application
   are different commands with different permissions.
2. **Only additive/metadata fields are ever proposable:** `title`, `status`,
   `superseded_by`, `supersedes`, `review_by`, `owner` *when absent*. Document
   bodies, authorship fields that are already set, file deletion, and file moves
   are **never** proposed as appliable actions. Archiving is a proposed
   `status: archived` frontmatter change, never a move — moves break inbound
   links, which is a retrieval regression disguised as tidying.
3. **Every proposal is a unified diff plus a rationale plus the evidence that
   produced it.** A proposal a human cannot audit is a bug.
4. **Rejections are permanent and content-hash-keyed.** A rejected proposal
   never reappears until one of its documents materially changes.
5. **Lint is warn-by-default.** Blocking requires opt-in config, and only a rule
   with a measured quality coefficient may ever block (see
   [Measurement](#measurement-and-what-is-not-measurable)).
6. **No corpus text leaves the box for maintenance analysis.** All detectors run
   against the local store. No provider call is required by any capability in
   this spec.

## Architecture

```
                    ┌───────────────────────────────────────────┐
   write path       │  content/**/*.md                          │
   (PUT /v1/pages,  └────────────────┬──────────────────────────┘
    connector sync,                  │
    editor save)                     ▼
                          ┌──────────────────────┐
                          │ Parser (existing)    │
                          └──────┬───────────────┘
                                 │ {frontmatter, ast, plain}
                    ┌────────────▼─────────────┐
                    │  LINTER (sync, per-doc)  │  ← Phase 0
                    │  structure + authority   │
                    │  field rules             │
                    └────────┬─────────┬───────┘
                             │findings │ (never blocks by default)
                             │         ▼
                    ┌────────▼──────────────────┐
                    │ Indexer (existing)        │
                    │ chunk → embed → store     │
                    └────────┬──────────────────┘
                             │
              ┌──────────────▼───────────────────────────────┐
              │ .remember/index.db                           │
              │  existing: chunks, vec_chunks, fts_chunks,   │
              │            pages, page_attrs, manifest,      │
              │            page_history                      │
              │  new (maintainer-owned):                     │
              │   doc_sketches      structure + LSH sketches │
              │   doc_pairs         candidate pairs+verdicts │
              │   retrieval_counters per-doc traffic         │
              │   query_observations text-free query stats   │
              └──────────────┬───────────────────────────────┘
                             │
   out-of-band scan  ┌───────▼──────────────────────────────┐
   (CLI / worker)    │ SCANNERS                             │
                     │  near-duplicate   (Phase 3)          │
                     │  supersession     (Phase 3)          │
                     │  conflict         (Phase 4)          │
                     │  staleness risk   (Phase 5)          │
                     │  orphans          (Phase 5)          │
                     │  coverage gaps    (Phase 2)          │
                     └───────┬──────────────────────────────┘
                             │ MaintenanceReport (versioned JSON)
                   ┌─────────┴──────────┬─────────────────┐
                   ▼                    ▼                 ▼
             report (md/json)   proposals/*.patch    cloud: PR + owner
                                (human apply only)   notification

   query path (read-only, ≤5ms added)
     search → scores ─▶ CONFIDENCE ESTIMATOR ─▶ query_observations (Phase 2)
                                    │                 (hash, buckets, no text)
                          conflict lookup on
                          returned path pairs  ─▶ EvidencePackage.conflicts
                                                   EvidencePackage.gaps
```

Two components touch the query path; everything else is out-of-band. The
confidence estimator consumes scores the engine already computed — no extra
retrieval. The conflict annotator is one indexed lookup over `doc_pairs` for the
pairs present in the returned set (≤ `finalK²/2` lookups, ≤45 at k=10).
**Speculative but bounded:** budget ≤5 ms combined, inside the existing 50 ms
p95 → 2 s budget headroom.

### Data model additions

All maintainer-owned, all derivable from the corpus, all safe to drop and
rebuild (consistent with "you can safely delete `.remember/` at any time" —
except `doc_pairs` verdicts and `retrieval_counters`, which are the two things
that are *not* derivable and therefore need an export/import path; flagged as a
design obligation, not solved here).

```sql
doc_sketches(
  path PRIMARY KEY, body_sha256, frontmatter_sha256,
  title_norm, heading_skeleton_sha256, heading_count, word_count,
  simhash BLOB,            -- 64-bit sign-of-random-projection over doc centroid
  shingle_bands TEXT,      -- MinHash banded keys, 5-gram word shingles
  doc_centroid BLOB,       -- mean-pooled chunk embedding
  authority_status TEXT, authority_date TEXT, updated_at TEXT
)
doc_pairs(
  path_a, path_b,                       -- lexicographically ordered
  cosine REAL, jaccard REAL, signals TEXT,
  relation TEXT,   -- near_duplicate|supersession|conflict|facet|unrelated
  detected_at TEXT, hash_a TEXT, hash_b TEXT,
  verdict TEXT,    -- NULL|accepted|rejected
  verdict_by TEXT, verdict_at TEXT,
  PRIMARY KEY (path_a, path_b)
)
retrieval_counters(path, day, retrieved, top1, evidence_used, PRIMARY KEY (path, day))
query_observations(
  query_hash, day, count, low_confidence_count,
  top1_score_bucket, margin_bucket, retriever_agreement_bucket,
  neighborhood_paths TEXT,   -- the docs the failing queries DID retrieve
  PRIMARY KEY (query_hash, day)
)
```

`body_sha256` is computed over the body **excluding frontmatter** so that a bulk
frontmatter migration does not reset every document's staleness clock. The
existing `page_history` table already stores `body` and `frontmatter` in separate
columns, so this split is already available.

### Report contract

One versioned artifact, modeled on `EvaluationRun` (`schema_version`, metadata,
summary, per-item detail) so it can be diffed across runs and asserted in CI:

```ts
interface MaintenanceFinding {
  id: string;                       // stable: rule + content hashes
  rule: string;                     // 'structure.missing_title', 'authority.dangling_superseded_by', ...
  severity: 'error' | 'warn' | 'info';
  confidence: number;               // 0..1, calibrated per rule
  paths: string[];
  evidence: Record<string, unknown>;// the numbers that fired the rule
  message: string;
  proposal?: { diff: string; requiresApproval: true };
  measuredCoefficient?: {           // ablation-derived quality impact
    fixture: string; metric: string; delta: number;
  };
}
```

`measuredCoefficient` is the mechanism that keeps this subsystem honest. A rule
without one is `warn` or `info` and may never be `error` (invariant 5).

## Capabilities

Each capability is specified as: detects / signal / output / automation /
false-positive risk / measurement.

### 1. Ingest-time linting

**Normative rule source.** [`docs/authoring-for-retrieval.md`](../../authoring-for-retrieval.md)
(landed 2026-07-25 by the engine workstream) is the human-facing statement of
these conventions — required frontmatter, the `status` vocabulary, the
one-H1 rule, path-token guidance. The linter must implement *that* document
rather than a parallel rule set, and any rule added here that is not in it should
be added there in the same change. Where the two disagree, the authoring doc wins
for wording and this spec wins for severity and measurement.

**Detects.** Documents that will retrieve badly, before they are ever queried:

| Rule | Fires when |
|---|---|
| `structure.missing_title` | no `frontmatter.title` **and** no leading `#` heading. `indexer/index.ts:pickTitle` already falls back to the file path, which silently hides this. |
| `structure.no_headings` | zero headings in a document over N words → the chunker's `heading_path` is empty, so `applyHeadingBoost` has nothing to work with |
| `structure.oversized_section` | a single heading section exceeds the 900-token chunk window by a wide margin → the chunk boundary lands mid-argument |
| `structure.title_not_distinctive` | normalized title duplicates another document's title, or is a bare generic (`README`, `Notes`, `Untitled`) |
| `structure.uninformative_filename` | the path carries no content words (`2026-q3-notes.md`, `doc1.md`, date-only or numeric stems). Path tokens carry the strongest metadata boost actually live in the ranker (`pathBoostFactor` 2 vs `headingBoostFactor` 1), so an uninformative filename discards the highest-weight signal the engine has |
| `structure.multi_topic` | a document's chunk centroids split into two well-separated clusters. Page-level deduplication returns one chunk per path, so a two-topic document competes with itself for a single slot. **Speculative** — needs a cluster-separation threshold calibrated on real corpora, and ships as `info` |
| `authority.missing_status` | no `status` field. Cheap, and the precondition for everything in §2–§4 |
| `authority.invalid_status` | `status` outside the configured vocabulary (`current`, `draft`, `superseded`, `deprecated`, `archived`, `rejected` — the vocabulary observed in `examples/confusable-wiki/`) |
| `authority.dangling_superseded_by` | `superseded_by` does not resolve to an existing document |
| `authority.unresolvable_superseded_by` | `superseded_by` is an opaque identifier, not a path. **Real, in the fixture:** `adr-007` says `superseded_by: ADR-011` while `data-retention-2023` says `superseded_by: policies/data-retention.md`. Two conventions in one 20-document corpus; neither the maintainer nor a future authority-aware ranker can follow the first one without a resolver |
| `authority.no_normalized_date` | the document carries recency in a per-type key (`date`, `updated`, `effective`, `retired`, `approved`) with no common field. All five occur in the fixture. Recency scoring is impossible without normalizing this |
| `authority.non_current_without_pointer` | `status` is `superseded`/`deprecated`/`rejected` but there is no `superseded_by`/`supersedes` pointer. **Real:** `services/billing-gateway-legacy.md` (deprecated, no pointer) and `adr-009` (rejected, no pointer to `adr-013`) |
| `duplicate.near_identical` | ≥0.9 shingle Jaccard against an existing document (see §2 for how candidates are found) |

**Signal.** Parser output only — frontmatter, AST, plain text — plus, for the
duplicate rule, the sketch table. No embedding call is needed for any rule
except `duplicate.near_identical`, which needs the sketch that indexing produces
anyway.

**Output.** Three surfaces, same rule set:
- `remember lint` — human table, exit 0.
- `remember lint --ci --changed-only` — exits non-zero on `error`. Diffs against
  the manifest to lint only changed paths, so it is proportional to the PR.
- Indexer hook — findings attach to the existing `IndexResult` and are emitted
  on the SSE `/v1/events` stream; `PUT /v1/pages` returns `warnings[]` in its
  200 response body.

**Automation.** Detection automatic. **`PUT /v1/pages` never rejects a write
because of a lint finding** unless `maintainer.strict` is configured. Refusing
an agent's or a human's save because their document lacks a heading is a
correctness-of-storage failure dressed as a quality feature; the document is
still the team's document. CI is where blocking belongs, because CI has a human
attached to it.

Title *proposals* (derive a title from the first heading, or from the filename
slug) are proposals, never auto-applied — a wrong title is worse than no title,
because it retrieves confidently.

**False-positive risk.** Low for the structure rules — they are properties of
the file, not inferences. Two real ones: `structure.no_headings` fires on
legitimately short atomic notes (mitigate with a word-count floor,
**speculative**: 300 words, calibrate against the corpora we have);
`structure.title_not_distinctive` fires on intentional per-directory `README.md`
files (mitigate by scoping distinctiveness to the directory).
`duplicate.near_identical` has a real and interesting false positive discussed in
§2.

**Measurement.** This is the one capability we can measure hard, *today*, and it
is the reason it goes first. Build a **structure-ablation fixture family** from
`hotpot-20000`, which is 100% titled:

| Variant | Transformation |
|---|---|
| `hotpot-20k-a` | baseline (titles + structure intact) |
| `hotpot-20k-b` | titles stripped from body and frontmatter |
| `hotpot-20k-c` | headings flattened, titles kept |
| `hotpot-20k-d` | both stripped |

Queries and qrels are unchanged, so no label leakage is possible — the only
variable is document structure. The measured deltas become the
`measuredCoefficient` for `structure.missing_title` and
`structure.no_headings`. **The reverse experiment (adding titles to fiqa) must
not be used as the primary evidence**: generating titles from document content
risks encoding query terms into the corpus and inflating the result. It can be
run as a secondary confirmation with a locally generated, query-blind titler,
labeled as such.

Rules with no ablation (`authority.*`, `duplicate.*`) ship as `warn`, and their
value is measured indirectly via §2–§4.

### 2. Supersession detection

**Detects.** Pairs where one document has replaced another, and the corpus does
not say so. Two sub-cases matter differently:
- **missing pointer** — one side already declares a non-`current` status but no
  `superseded_by` (fixture: `billing-gateway-legacy`, `adr-009`). Cheap, high
  precision, no similarity inference required at all.
- **undeclared supersession** — neither side declares anything and one has
  quietly replaced the other. This is the hard, inference-heavy case.

**Signal — candidate generation without O(n²).** Being precise about this,
because the naive approach fails at the scale we care about: `vec_chunks` is a
`sqlite-vec` `vec0` table, and its KNN is a linear scan per query. One KNN probe
per document is therefore n² distance computations — at 100k docs × 384 dims
that is ~10¹⁰ dimension-ops, minutes-to-hours and not incremental. Not viable.

The design is **blocking first, similarity second**, in four cheap passes over
`doc_sketches`:

1. **Structural blocking (O(n), exact keys).** Group by: same directory + same
   title slug family (`secret-rotation` / `secret-rotation-legacy-vault`), same
   `heading_skeleton_sha256`, same document series prefix (`adr-###`), same
   `title_norm`. This alone finds every supersession pair in the fixture except
   `billing-gateway-legacy → billing-orchestrator`.
2. **Lexical blocking (O(n) with small constants).** MinHash over 5-gram word
   shingles, banded LSH; documents sharing any band become candidates. Standard
   near-duplicate detection, and the same sketch serves
   `duplicate.near_identical` in §1.
3. **Semantic blocking (O(n·k)).** 64-bit SimHash (sign of k fixed random
   projections) over the mean-pooled document centroid, bucketed into 8 bands of
   8 bits. Bucket collisions become candidates. Build cost is one pass; probe
   cost is a hash lookup.
4. **Exact scoring only on survivors.** Cosine on centroids + Jaccard on
   shingles, computed for the candidate set only. **Speculative:** candidate set
   should be O(n · small constant); on 100k docs this needs to be measured
   before the band widths are fixed, and the scan must be able to cap itself and
   report truncation rather than run unbounded.

Steady state is incremental: each index run probes only changed documents
against existing sketches. The full pass is a one-time backfill.

**Directional evidence (the part that decides, not the similarity).** High
similarity establishes *candidacy only*. To propose supersession, require **at
least two independent directional signals**:

- an explicit `supersedes` on the newer side, or prose matching a
  "replaces/supersedes/deprecated in favour of" pattern;
- monotonic version or series ordering within a family (`version: 2` → `3`,
  `ADR-007` → `ADR-011`);
- a non-`current` `status` on exactly one side;
- normalized-date ordering **with** a substantive-body-edit gap (frontmatter-only
  touches do not count);
- inbound-link flow: the newer document is linked from active pages, the older is
  not linked from anywhere current.

**Hard exclusion rule.** Never propose supersession when the two documents'
distinguishing tokens are facet markers — `staging`/`production`,
`us`/`eu`, `v1`/`v2` as an API surface rather than a doc revision, tenant or
region names — in path, title, or frontmatter. Emit a `facet` relation instead.
This is grounded, not hypothetical: `config/staging-api-config.md` and
`config/production-api-config.md` are deliberately near-identical, both
`status: current`, both `updated: 2026-07-14`, and one of them takes rank 1 on
`amb-tenant-rate-limit`. It is the single stale-at-rank-1 offender that is not
stale. A similarity-plus-age heuristic without this rule would have told the
team their live staging document was dead.

**Output.** `relation` rows in `doc_pairs`, plus a frontmatter-only diff proposal
per accepted pair:

```diff
--- a/services/billing-gateway-legacy.md
+++ b/services/billing-gateway-legacy.md
@@
 status: deprecated
+superseded_by: services/billing-orchestrator.md
```

**Automation.** Proposal only, always. Missing-pointer findings (`status` already
non-current) can be `warn` severity because they assert nothing new about
authority — the document already said it was dead. Undeclared-supersession
findings are `info` with a confidence score until the detector has a measured
precision number.

**False-positive risk — the highest in this spec.** A false positive tells a team
their live document is dead. Mitigations, in order of importance: the facet
exclusion rule; two-independent-signal minimum; proposal-only with the evidence
attached; permanent hash-keyed rejection so a human's "no" sticks; and a
per-scan cap on proposals so a mis-tuned threshold produces a reviewable list
rather than a 400-file pull request. Thresholds (**speculative constants**,
calibration is a deliverable): Jaccard ≥0.9 → duplicate; 0.75–0.9 with ≥2
directional signals → supersession proposal; 0.75–0.9 with 0–1 signals →
`info`, no proposal.

**Measurement.** Two separate things, and conflating them would be dishonest.

- **Detector precision/recall is measurable now.** `examples/confusable-wiki/`
  is already a labeled pair fixture. Ground truth as it stands: 4 declared
  supersession pairs (`adr-007→adr-011`, `deploy-v1-jenkins→deploy`,
  `secret-rotation-legacy-vault→secret-rotation`,
  `data-retention-2023→data-retention`), 1 undeclared
  (`billing-gateway-legacy→billing-orchestrator`), and four required negatives:
  the staging/production facet pair, `adr-009` (rejected alternative, *not*
  superseded by `adr-013`), the never-adopted `incident-severity-matrix` draft,
  and unrelated singletons. This needs a committed
  `confusable-wiki.pairs.jsonl` label file and a metric — proposal precision,
  recall, and **facet-pair false-positive count, which must be 0**.
- **End-to-end retrieval improvement is NOT measurable by this subsystem**, and
  will not be until the engine consumes authority metadata. The 53.8%
  stale-at-rank-1 figure was measured on a corpus where 13/14 offenders already
  carried a non-`current` status. Completing the metadata cannot move that
  number by itself. Stated plainly: **§2 is necessary and not sufficient; the
  ranking half is a dependency on the engine workstream, not a deliverable
  here.** The joint experiment — authority-aware demotion, measured as nDCG@5
  and per-class wrong-source on `confusable-wiki` — is the one that produces a
  quality claim, and it needs both halves.

### 3. Conflict surfacing

**Detects.** Two documents that answer the same question *differently*, where
neither supersedes the other. Distinct from §2 in kind, not degree:

| | Supersession | Conflict |
|---|---|---|
| Nature | one document is dead | both documents are live |
| Fix | metadata (mark the pointer) | a human decision about which is true |
| Owner | the maintainer proposes it | escalate to the document owners |
| Retrieval effect | demote the dead one | surface both, flag the disagreement |
| Wrong response | ranking tweak | silently picking a winner |

Sub-kinds worth separating: **facet conflicts** (staging vs production — not a
disagreement, a scoping failure in the query or the docs), **unadopted-draft
conflicts** (`incident-severity-matrix` draft contradicts the approved
`incident-severity`, using different level names and timings — the draft is not
superseded, it was never adopted), and **genuine live disagreement** (two
`status: current` documents stating incompatible facts) which is an
organizational problem to escalate.

**Signal.** Candidate pairs come from §2's blocking passes; the discriminator is
different. High topical similarity **plus** divergence on extractable
value-bearing spans within matching heading contexts: numbers with units
(timeouts, retention windows, ack times, rate limits), enumerated level or
severity names, and named tools. Both sides `status: current` (or one an
unadopted `draft`) and no directional evidence → `relation = 'conflict'`.

**Speculative:** the numeric-divergence-under-matching-heading heuristic is the
part of this spec I have the least evidence for. It is plausible on the fixture
(`contra-rotation-cadence`, `contra-sev1-ack-time`,
`contra-audit-event-retention` are all numeric divergences) but that is 7
queries in one authored corpus.

**Output.** Two consumers, and this is where the existing type earns its keep:
- Corpus-time: findings in the maintenance report, grouped by owner pair, with
  the divergent spans quoted side by side.
- Query-time: `EvidencePackage.conflicts`. `createEvidencePackage` already
  accepts `conflicts: Array<{id, chunkIds, description}>` and already drops any
  conflict whose passages are not both present in the package
  (`passage_ids.length > 1` filter). So the annotator only needs to look up
  returned paths in `doc_pairs` and pass them through. **No change to
  `evidence.ts` is required** — the seam is already correct.

**Automation.** Detection automatic; **no proposal is ever generated for a
genuine live conflict.** There is no correct diff — the resolution is a human
decision about which statement is true. Output is a report entry plus, in cloud,
an owner notification. Facet conflicts may get a proposal, and only a scoping one
(add `environment:`/`region:` to frontmatter so a future filter can disambiguate).

**False-positive risk.** Moderate. Numbers legitimately differ across facets
(that is the staging/production pair's entire purpose) and across time
(`version: 2` retention windows vs `version: 3`). Mitigated by requiring both
sides live-and-non-superseded and by treating facet-marked pairs as facets
first. A false-positive conflict is much cheaper than a false-positive
supersession: it wastes a human's attention, it does not mislabel a document.

**Measurement.** Detector precision/recall against the same
`confusable-wiki.pairs.jsonl` labels — the fixture already has a
`contradictory` query class (7 queries) built on known conflicting pairs.
**Whether surfacing a conflict helps a downstream agent is NOT measurable in
this harness**: there is no answer-layer metric here, and `EvidencePackage`
content is not scored by the evaluation runner. Measuring that requires the
Phase 3 Answer work in cloud and a fabrication/unsupported-claim metric. Do not
claim agent benefit until then.

### 4. Staleness risk

**Detects.** Documents whose age has become dangerous *because they are being
used*. A frequently-retrieved three-year-old runbook is a live incident waiting
to happen; a three-year-old meeting note nobody retrieves is inert.

**Signal.**

```
risk = f_age(days_since_substantive_body_edit)
     × f_traffic(retrievals, top1_hits, evidence_used)
     × f_blast_radius(doc_class)
```

- `f_age` uses the *normalized* date (hence `authority.no_normalized_date` in
  §1) and `body_sha256`-based substantive-edit detection, so frontmatter
  migrations do not reset the clock.
- `f_traffic` needs telemetry that does not exist yet: **per-document retrieval
  counters** — retrieved-in-top-k, taken-rank-1, and (when the caller reports it)
  included-in-evidence. Document paths, day buckets, counts. No query text, no
  user identity, no intent. This is the whole telemetry ask for §4 and §6.
- `f_blast_radius` is class-weighted from frontmatter (`tags`/path): runbook,
  policy, config > architecture decision > reference > meeting note. **Speculative
  weighting**; it should ultimately be configurable per workspace rather than
  guessed centrally.

**Output.** A ranked review queue: "these 12 documents are old, heavily
retrieved, and high blast radius." Optional proposal: add
`review_by: <date>` frontmatter, which is additive and reversible. In cloud, an
owner notification derived from `frontmatter.owner`.

**Automation.** Detection automatic, output advisory. Wording is a design
requirement, not a nicety: the output says **"due for review"**, never "stale"
or "dead". The system does not know whether the document is still true; it knows
it is old and busy.

**False-positive risk.** Structurally low-harm, because nothing is asserted about
correctness and no content changes. The real risk is alert fatigue — a first run
over a five-year-old wiki will flag hundreds of documents and be ignored. Mitigate
by ranking rather than thresholding, capping the queue (**speculative**: top 20
per run), and requiring a traffic floor so untouched documents never enter the
queue at all.

**Measurement.** Partially measurable, using an indirect but real proxy: on
`confusable-wiki`, the 14 documents that took rank 1 while being the stale member
are a known offender set. A staleness-risk scorer should rank those 14 above the
corpus's other documents — measure as precision@14 / AUC against that label set.
Traffic can be simulated by replaying the fixture's own queries to generate
counters. **Fully honest caveat: the traffic term itself is not measurable
without production telemetry.** Replayed benchmark queries are not a traffic
distribution, and any claim about traffic-weighted risk before real counters
exist is an assertion, not evidence.

### 5. Coverage gaps

**Detects.** Recurring information needs the corpus does not serve.

**Constraint.** Cloud deliberately keeps query text and intent out of telemetry:
workspace-scoped query hashes, timings, and counts only. A gap detector that
needs the query text is therefore not shippable in cloud. Designing inside the
constraint rather than around it:

**Signal — failure detection without text.** The engine already computes
everything needed to know a query went badly, at query time:

- top-1 fused score below a calibrated floor;
- small margin between top-1 and top-{5,10} (a flat score profile means nothing
  stood out);
- single-retriever support — `SearchResult.retrievers` has one entry for the whole
  top-k, i.e. BM25 and vector did not agree on anything;
- low cohesion among returned documents (mean pairwise centroid distance high →
  the engine returned k unrelated things);
- zero results.

These become a **calibrated confidence estimator** producing one
`low_confidence` flag plus bucketed scores. Stored as
`query_observations(query_hash, day, count, low_confidence_count, …)`. The hash
is workspace-scoped (HMAC under a per-workspace key) so it cannot be dictionary-
attacked across workspaces or joined to another tenant.

**Signal — naming the gap without the text.** A hash tells you *that* a need
recurs, not *what* it is. The resolution: describe the gap by its **retrieved
neighborhood** rather than its query. For each recurring low-confidence
`query_hash`, store the paths and tags it *did* retrieve. The report then reads:
"17 recurring low-confidence queries land near `policies/data-retention.md`,
`policies/incident-severity.md`, tag `retention` — probably no document answers
them." That is actionable by a human who knows the domain, and it contains no
query text.

**Asymmetry, stated deliberately.** In OSS local mode the corpus, the queries,
and the machine all belong to one person, so opt-in local query-text logging
into `.remember/` is legitimate and far more useful. It must be off by default,
never synced, and never available in cloud. The cloud tier gets hash +
neighborhood only. Same detector, different retention policy per deployment.

**Output.** A gap cluster list in the report: neighborhood description,
recurrence count, low-confidence rate, first/last seen. In cloud, a trend view.
Also feeds `EvidencePackage.gaps` — noting two distinct producers of that field:
query-time ("no source above the confidence threshold for this request") and
corpus-time ("this neighborhood is known to be uncovered").

**Automation.** Fully automatic detection, report-only output. There is nothing
to propose — the fix is writing a document, which is human work.

**Measurement.** The strongest measurement story after §1, and it is available
now: the fixtures already contain **25 genuinely unanswerable queries** (15
hotpot, 10 fiqa, built by excluding gold documents) plus 5 in `confusable-wiki`.
The confidence estimator's job is exactly to separate answerable from
unanswerable, so measure **ROC-AUC and precision/recall at the operating
threshold on that split**. Current baseline is unambiguous: wrong-source
`1.000` on unanswerable queries, i.e. the estimator does not exist yet.

The architectural payoff: **this is the same estimator effort B (wrong-source
guard + abstention) needs.** Coverage-gap detection and query-time abstention are
one calibrated confidence model with two consumers. Build once, measure once on
the unanswerable split, use in both places. That is why §5 outranks §2–§4 in
phasing despite looking like the softest capability.

### 6. Orphans

**Detects.** Documents never retrieved over a long window — archive candidates.

**Signal.** `retrieval_counters` (same telemetry as §4) plus corpus signals that
distinguish *unretrieved* from *unretrievable*: zero inbound links, zero chunks
(empty document), a title that duplicates a busier document, or an indexing
error. An orphan with lint findings is not an archive candidate — it is a
**repair** candidate, and that distinction is most of this rule's value. A
window shorter than a full business cycle is meaningless; **speculative**
minimum 180 days, and the report must refuse to run when the counter history is
shorter than the configured window rather than reporting everything as an orphan.

**Output.** Ranked archive-candidate list. Optional proposal: `status: archived`
frontmatter — never a file move, never a delete (invariant 2).

**Automation.** Report + proposal only. Archiving is authorship-adjacent and
irreversible in practice (an archived document drops out of the team's working
set even if the file survives), so it requires per-document human approval, never
a bulk apply.

**False-positive risk.** The dangerous case is the **rarely-needed but critical**
document: the disaster-recovery runbook retrieved once a year, or the compliance
policy retrieved only during an audit. Traffic-based orphan detection will flag
exactly those. Mitigations: never propose archival for high-blast-radius classes
regardless of traffic; require zero retrievals *and* zero inbound links *and* no
lint findings; and let workspaces pin documents as never-archivable.

**Measurement. Not measurable in the current harness.** Orphanhood is defined by
production traffic over months, and the benchmark has neither. The only thing
measurable now is a **safety property**, and it should be a hard gate: replay
every fixture query against the corpus and assert that **no document which is
gold for any query is ever labeled an orphan.** That catches the failure mode
that matters (archiving something people need) without pretending to validate
the feature. Everything else about §6 is a hypothesis until real counters exist.

## Where it runs

| Surface | Contents | Why there |
|---|---|---|
| `remember lint` (CLI) | §1 rules over the whole corpus or `--changed-only` | local, fast, no telemetry needed |
| `remember maintain scan` (CLI) | §2–§4, §6 detectors over the local store; writes a `MaintenanceReport` | expensive, out-of-band, must be explicitly invoked |
| `remember maintain propose` / `apply <id> --yes` | proposal generation, and the single human-gated write path | separation of detect from apply is invariant 1 |
| CI check | `remember lint --ci --changed-only`, exit non-zero on `error` | the only place blocking is appropriate — a human is attached |
| Indexer hook | §1 rules, warn-only, findings on `IndexResult` + SSE | catches connector-written and agent-written documents that never see CI |
| Query path | confidence estimator (§5), conflict annotator (§3) | must be inline; both are cheap and read-only |
| Background worker | scheduled `scan`, counter rollups, gap trends, notifications | needs a scheduler, durable telemetry, and an identity to notify |

### Open-source core vs paid cloud

The split follows a single rule: **detectors and contracts are MIT core;
scheduling, retention, workflow, and audience are cloud.**

**Core (MIT).** All lint rules; sketching and blocking; all pair detectors;
staleness and orphan scoring functions; the confidence estimator; the
`MaintenanceReport` and `MaintenanceFinding` schemas; proposal diff generation;
the CLI commands; the ablation and pair-label fixtures. A single-team OSS user
gets the full detection capability by running the CLI.

**Cloud (paid).** Scheduled scans and their history; durable multi-user
telemetry (`retrieval_counters`, `query_observations`) with workspace-scoped
hashing and retention policy; trend views over time; owner routing and
notification from `frontmatter.owner`; the proposal→pull-request workflow
against the team's repository; org-level escalation of live/live conflicts;
review-queue state and SLAs.

Rationale: the detectors are the part that must be inspectable — a system that
tells a team a document is dead has to be auditable, and an opaque paid
heuristic is not. The recurring-workflow, memory, and coordination layer is
where hosted value legitimately lives. Nothing cross-workspace is ever computed;
no maintenance analysis sends corpus text to the vendor.

## Phasing

Ranked by leverage-per-effort using the measured facts, not by narrative order.

| # | Phase | Leverage | Effort | Measurable now? |
|---|---|---|---|---|
| 0 | Structure lint (warn) + structure-ablation fixture | **Highest** — targets the 32-point gap | Low | **Yes**, directly |
| 1 | Authority-field lint + normalization + retrievability report | High — the substrate everything else needs | Low | Coverage %, not quality |
| 2 | Confidence estimator → abstention signal + coverage gaps | High — shared with effort B | Medium | **Yes**, 30 unanswerable queries |
| 3 | Sketching, blocking, near-dup + supersession proposals | Medium alone, high when paired with engine authority | Medium-High | Detector P/R yes; quality no |
| 4 | Conflict surfacing into `EvidencePackage.conflicts` | Medium | Medium | Detector P/R yes; agent benefit no |
| 5 | Traffic counters → staleness risk + orphans | Unknown until telemetry exists | Medium + telemetry | No (safety gate only) |

**Phase 0 first, and it is not close.** The 32-point structure gap is the largest
measured effect anywhere in this project, larger than every ranking change
shipped so far combined. The intervention is a parser-output check — no
embeddings, no telemetry, no inference, no risk of mislabeling a document. And
it is the only capability whose value we can quantify *before* building it, via
an ablation on a corpus we already have. Ship the ablation fixture in the same
phase as the rules, so every rule arrives with a coefficient instead of an
opinion.

**Phase 1 is cheap and unlocks the rest**, but its honest framing is that it
completes metadata rather than improving retrieval. The `status`/date/pointer
normalization is what a future authority-aware ranker will read, and the
`superseded_by: ADR-011`-vs-path inconsistency in a 20-document fixture is
evidence that real corpora will not be normalized without a lint rule forcing
it.

**Phase 2 outranks supersession detection**, which is the least obvious call
here. Three reasons: the 100%-no-abstention failure is worse than the 54%
stale-first failure (a confident wrong answer with no signal beats a
correctly-retrieved document ranked second); it is measurable today against 30
existing unanswerable queries; and the estimator is a shared dependency with the
already-planned wrong-source guard, so its cost is partly already committed.

**Phase 3 is deliberately demoted** on the evidence: 13 of the 14 documents that
took rank 1 while stale already declared a non-`current` status, so a detector
that finds *more* supersessions would not have changed that measurement. The
binding constraint is that the engine ignores authority, and that lives in the
engine workstream. Building the detector before its consumer produces proposals
nobody's ranking can use, plus the highest false-positive risk in the subsystem.
Sequence it after, or in parallel with, the engine-side authority signal — and
measure the pair together on `confusable-wiki` nDCG@5.

**Phase 5 last**, because it is the only phase that cannot be measured at all
until telemetry has accumulated over months. Shipping unmeasurable heuristics
that tell teams their documents are dead is exactly backwards for a project
whose standard is benchmark-backed claims.

## Risks

- **False-positive supersession is the top risk.** Telling a team a live
  document is dead damages trust in the whole product, and one bad proposal is
  remembered longer than fifty good ones. Controls: facet exclusion (grounded in
  a real fixture pair), two-independent-directional-signal minimum,
  proposal-only, permanent hash-keyed rejection, per-scan proposal caps.
- **Alert fatigue makes correct findings worthless.** A first run over a mature
  wiki will produce thousands of findings. Controls: warn-by-default, ranked and
  capped queues, `--changed-only` in CI, and a "new since last scan" view as the
  default report surface rather than the full backlog.
- **Unmeasurable features shipping as claims.** §4 and §6 cannot be validated
  before real telemetry. Control: the report schema carries
  `measuredCoefficient`, and its absence is visible in the output; no
  documentation may quote a quality number for a capability without an artifact
  in `benchmarks/results/`.
- **Threshold constants are all speculative today.** Every numeric threshold in
  this document is a starting point requiring calibration on
  `confusable-wiki` + the BEIR corpora. Calibration is a deliverable, not a
  tuning afterthought.
- **Blocking ingest breaks trust in storage.** Mitigated by warn-by-default and
  keeping the blocking surface in CI. A knowledge base that refuses writes is
  worse than one with imperfect documents.
- **Telemetry scope creep.** The constraint (hashes, timings, counts) is real and
  designed-within here. Any future proposal to store query text in cloud
  invalidates §5's privacy posture and must be treated as a product-level
  decision, not an implementation convenience.
- **`doc_pairs` verdicts and `retrieval_counters` are the only non-derivable
  state in `.remember/`.** Today's contract is that the directory can be deleted
  freely. Either that contract changes for these two tables, or they need an
  export path. Unresolved here; must be decided before Phase 3.

## Out of scope

- Any engine change: authority-aware ranking, recency boosting, status filtering,
  abstention thresholds in the search path. This spec produces the *signals* those
  need; consuming them is the engine workstream's decision.
- Content generation. The maintainer never writes prose, never drafts a
  missing document, never rewrites a body.
- Answer-layer metrics (citation validity, unsupported-claim rate). Those belong
  to cloud Phase 3 and are what would make §3's agent-facing value measurable.
- Cross-workspace or aggregate-tenant learning. Never.
- Modifying `sample-wiki` or its questions — the CI gate's committed baselines
  pin its `corpus_hash` and `questions_hash`. New fixtures only.
