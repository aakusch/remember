# Authoring for retrieval

Status: standard for documents staged into a `remember` corpus. Grounded in the
2026-07 retrieval measurements in [`benchmarks/retrieval/README.md`](../benchmarks/retrieval/README.md)
and the engine behavior described in [`architecture.md`](./architecture.md).

## Why this exists

Same engine, same 20,000 documents, same week. The only difference is how the
documents were written. The metric is "at least one correct document anywhere in
the returned set."

| Corpus | Document shape | Hit@5 | Hit@10 |
|---|---|---:|---:|
| `beir-hotpotqa` | one `# Title` H1, one topic per document | 97% | 98% |
| `beir-fiqa` | no title, no headings, overlapping topics | 58% | 66% |

A 32-point gap at identical scale. FiQA documents ship with empty title fields,
so every title-derived signal is dead for them and the retriever has nothing but
an undifferentiated wall of prose to match against.

For comparison, the cost of corpus *growth* on the hard corpus is smaller than
the cost of bad structure:

| Documents | Hit@10 (hard corpus) |
|---:|---:|
| 1,000 | 90% |
| 5,000 | 82% |
| 10,000 | 70% |
| 20,000 | 66% |

**Document structure matters more than corpus size.** You cannot control how big
the corpus gets. You can control this.

## The rules

| # | Rule | Why |
|---|---|---|
| 1 | Every document opens with exactly one `# H1` that names the thing | The title-bearing corpus retrieves 32 points better at the same scale. The H1 is the highest-value line in the file. |
| 2 | Frontmatter carries `title`, `status`, `owner`, `date` | `title` populates the `pages` table and the `/v1/pages?q=` lookup; `status` is what lets a consumer stop citing dead documents (see rule 3). |
| 3 | Anything not current declares `status` and `superseded_by` | On the confusable fixture the engine ranks a **stale** document at position 1 on 14 of 26 queries (54%) — more often than the correct one (42%). It has no notion of authority or recency. Declared status is the only machine-readable signal that a document is dead. |
| 4 | Sections get meaningful `##` headings, named after what a reader would search for | Headings are captured per chunk as `heading_path` and are wired into `applyHeadingBoost`. Heading text also stays in the chunk body, so BM25 and the embedder see it either way. (Caveat in [Known limits](#known-limits-of-this-advice).) |
| 5 | Each section stands on its own | Chunks are retrieved individually, not documents. A section that only makes sense after three pages of setup retrieves as an orphan. |
| 6 | The filename describes the content in words | Path tokens carry the strongest metadata boost actually live in the ranker today (`pathBoostFactor` default 2, vs `headingBoostFactor` 1). `2026-q3-notes.md` boosts nothing. |
| 7 | One topic per document; split when a document grows two subjects | Page-level deduplication returns one chunk per path, so a two-topic document competes with itself for one slot. |

## Required frontmatter

```yaml
---
title: "ADR-011: Stateless access tokens with rotating refresh tokens"
status: current            # current | superseded | deprecated | draft | archived
owner: identity
date: 2026-01-22
tags: [adr, auth, sessions, engineering]
superseded_by: engineering/adrs/adr-011-auth-sessions-jwt.md   # required unless status: current
---
```

| Field | Required | Retrieval purpose |
|---|---|---|
| `title` | yes | Indexed into `pages.title`; drives `/v1/pages?q=` and `sort=title`. Should match the H1. |
| `status` | yes | Present on every `SearchResult.frontmatter`, so consumers and future ranking stages can demote dead documents. Without it, a superseded document is indistinguishable from the live one. |
| `owner` | yes | Team or person to route a correction to when retrieval surfaces something wrong. Filterable via `/v1/pages?filter[owner]=identity`. |
| `date` | yes | The only recency signal in the corpus. ISO `YYYY-MM-DD`; sortable via `/v1/pages?sort=-date`. |
| `superseded_by` | when `status` is not `current` | Lets a consumer follow the pointer to the live document instead of citing the dead one. Use a **content-relative path**, not a bare human ID — a path is resolvable, `ADR-011` is not. |
| `tags` | recommended | Array membership is filterable (`/v1/pages?filter[tags]=runbook`) and tag words add lexical surface. |

Status values:

| `status` | Meaning | Expectation |
|---|---|---|
| `current` | The live answer | Safe to cite |
| `superseded` | A newer document replaced it; kept for history | Cite only for history, must set `superseded_by` |
| `deprecated` | Actively wrong to follow now | Must set `superseded_by`, must say so in the first body paragraph |
| `draft` | Not yet authoritative | Never cite as policy |
| `archived` | Retained for the record, no successor | Cite only as a record |

Do not rely on frontmatter alone to communicate deadness. State it in the first
body paragraph too — that is the text that lands in the snippet an agent reads:

```markdown
**Superseded by ADR-011 (2026-01-22).** Do not cite this page as the current
session design.
```

## Chunking reality

The default chunker is `createSmartSplitChunker({ size: 900, overlap: 0.15 })`
(`packages/core/src/chunkers/smart-split.ts`). `size` is in **tokens** and is
converted at 4 characters per token, so:

| Parameter | Default |
|---|---|
| Target chunk | ~900 tokens ≈ 3,600 characters |
| Overlap carried from the previous chunk | 15% ≈ 540 characters |
| Split preference | section → paragraph → sentence → hard cut |
| Returned snippet | ~280 characters, query-aware (`packages/core/src/search/snippet.ts`) |

Consequences for authoring:

- A ~3,600-character window is roughly 500–600 words. Aim for sections that
  answer their own heading inside that.
- Only ~540 characters of preceding context travel into the next chunk. Nothing
  else does. Pronouns and "as described above" do not survive the cut.
- Re-state the subject at the top of each section. "The rotation cadence is 90
  days" beats "It runs every 90 days" — the second chunk may be all a retriever
  ever sees.
- Define an acronym in the section that uses it, not once at the top of the file.
- Long tables and code blocks get hard-cut mid-structure. Keep them under the
  window or break them into labeled sections.

## What actively hurts

| Anti-pattern | Effect |
|---|---|
| No H1, no `title` | The FiQA case: 58%/66% instead of 97%/98%. The single most expensive mistake. |
| Two near-duplicate documents, neither marked | The 54% stale-at-rank-1 failure. The engine cannot break the tie and picks nearly at random. |
| 4,000 words with no `##` headings | One undifferentiated blob split at sentence boundaries; every chunk carries an empty `heading_path`. |
| Meaning that lives only in the filename or folder path | Path tokens boost the ranking, but the *snippet* comes from body text. A reader gets a passage that never says what system it is about. |
| Dates/IDs as filenames (`2026-07-22.md`, `doc-4471.md`) | Forfeits the path boost — the strongest metadata signal currently live. |
| Copying a section into five documents | Five near-identical chunks compete for the same slots and page dedup gives you one arbitrary winner. |
| "See the other doc" with no restatement | Cross-references are not followed at retrieval time. A pointer-only chunk is a dead result. |
| Frontmatter deadness without body deadness | Snippets come from body text; an agent reading only snippets will cite the dead document confidently. |

## Example

Bad — untitled, undifferentiated, self-referential, non-descriptive filename:

```markdown
<!-- notes/2026-07-22.md -->
We talked about the rotation thing again. As mentioned above, it's still on the
old cadence, and the new approach replaces it but we haven't cut over yet. The
script is the same one from before. Ping the usual channel if it fails.
```

Nothing here retrieves: no title, no headings, no named system, no status, and
the filename carries a date instead of a subject.

Good — same information, retrievable:

```markdown
---
title: "Secret rotation runbook (self-hosted Vault)"
status: deprecated
owner: security
date: 2026-04-15
superseded_by: engineering/runbooks/secret-rotation.md
tags: [runbook, secrets, vault, security]
---

# Secret rotation runbook (self-hosted Vault)

**Deprecated — do not follow this procedure.** The self-hosted Vault cluster was
drained on 2026-04-15. The live procedure is
[secret rotation](./secret-rotation.md). This page is retained because SOC 2
evidence for 2024–2025 rotations references the ticket and script names below.

## Rotation cadence (historical)

The self-hosted Vault rotation ran on a 90-day cadence, triggered by the
`vault-rotate` Jenkins job. The 90-day figure is still quoted in old onboarding
decks; the current cadence is 30 days.

## Escalation (historical)

Failures paged the security on-call rotation via `#sec-oncall`.
```

Filename `engineering/runbooks/secret-rotation-legacy-vault.md`: path tokens
`secret`, `rotation`, `legacy`, `vault` all earn the path boost, the H1 repeats
them, each section names its own subject, and both the frontmatter and the first
paragraph declare the document dead.

## Known limits of this advice

Stated plainly so nobody over-trusts this document:

1. **`status` is not consumed by ranking today.** `SearchResult.frontmatter` is
   parsed and returned, and the `/v1/pages` API can filter on it, but no scoring
   stage reads it. Authoring `status` today makes the fix possible and lets
   consumers filter (see [`agent-search-guide.md`](./agent-search-guide.md)); it
   does not currently change result order by itself.
2. **The staleness measurement is partly self-fulfilling.** The 54% figure comes
   from `examples/confusable-wiki`, a 20-document fixture authored *with* clean
   status frontmatter and explicit deadness paragraphs. It demonstrates that the
   engine ignores authority signals that are present; it does not prove that a
   messy real corpus becomes clean by adopting this standard. Real corpora have
   missing fields, lying fields, and documents nobody has touched in three years.
3. **The dedicated heading signal is not live in the default pipeline.** The
   default parser (`packages/core/src/parsers/remark.ts`) flattens markdown to
   plain text with `mdast-util-to-string` before the chunker runs, which strips
   `#` markers and line breaks. `splitByHeadings` matches `/^#{1,6}\s+/`, so with
   that parser `heading_path` comes back empty and `applyHeadingBoost` is a
   no-op. Heading and title text still help — they remain in the chunk body where
   BM25 and the embedder see them, which is the mechanism behind the 32-point
   gap on a corpus whose filenames are numeric IDs. Write headings anyway: they
   cost nothing, they are what makes chunks self-contained, and the scoring seam
   is already wired for when the parser preserves structure.
4. **The BEIR fixtures are subsets.** Absolute scores are not comparable to
   published leaderboard numbers; only deltas on the same fixture are meaningful.
   The 32-point gap is a same-engine, same-scale comparison, which is the claim
   being made here — nothing more.
5. **Retrieval quality is not the bottleneck that latency is.** p95 is 18–49 ms
   from 1k to 20k documents against a ~2 s budget. Authoring for retrieval buys
   accuracy, not speed; do not trade clarity for index size.
