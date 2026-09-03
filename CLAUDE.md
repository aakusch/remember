# CLAUDE.md — remember (open-source engine)

Operating brief for an agent working in this repo. Read this before editing.

## What this is

`@useremember/core` — the **MIT, open-source "basic" retrieval engine** for `remember`,
published to npm (`0.3.1` is **live** on `latest`), public. Local-first, **CLI + HTTP API only — there is
no browser UI in this repo.** It is a real, useful search engine and the top of the funnel.

Verify with `npm view @useremember/core version` before repeating that number. This line read
"0.3.0 staged, unpublished" for a while *after* 0.3.0 had shipped — and a stale release claim in
the first file an agent reads is worse than no claim, because it changes what the agent believes
is still safe to break.

The **pro engine** — the quality levers, the browser viewer, subwikis, scoped API keys,
doc-health, and HTML ingestion — is a **separate PRIVATE package and is not in this repo.**
Do not reference, import, or assume any of it here.

**This boundary moved, and older claims about it are stale.** Office *and* PDF ingestion now
ship here, so "multi-format ingestion is pro-only" is wrong wherever it still appears.
**HTML is the only format still pro-only** — this engine has no HTML parser, and that is not
a licence to port the pro extractor. PDF is now the *same* implementation in both engines
(`@firecrawl/pdf-inspector`, same parser, same page classification and OCR flags), and DOCX
converged too (pro moved off mammoth onto anydoc at its own `PIPELINE_REV` 5).

What still genuinely differs is **ranking quality and the surfaces around it** — the query
path, the browser viewer, subwikis, scoped keys, doc-health — not the file formats. Never
cite a pro-engine benchmark number as this engine's, and never claim the two run the same
*engine*: ingestion overlapping is not ranking overlapping.

Engine: hybrid **BM25 (SQLite FTS5) + vector (sqlite-vec, local BGE embeddings)** fused with
**Reciprocal Rank Fusion**. One index, queried by people and agents over HTTP.

`packages/core` is the whole thing: `cli/`, `api/`, `search/` (the query path — start at
`search/hybrid.ts`), `indexer/`, `stores/` (sqlite-vec), `parsers/`, `embedders/`, `chunkers/`,
`benchmarks/`. CLI commands: `setup · init · index · search · list · get · status · doctor ·
tools · capabilities · dev · start · mcp · benchmark`. `remember dev` runs the API with file-watch
(reindex within ~1s) — **CLI + API only, no browser UI**.

**No built-in connectors.** Ingestion is deliberately not the engine's job: the wiki is plain
markdown, so the user's agent (or the user) writes markdown into `content/` — pulling from Granola,
Obsidian, exports, etc. Managed/turnkey connectors are a *Pro* concern. Do not add source-specific
connectors (Granola API, Obsidian sync) back into this repo. See `content/remember.md`'s
"bring content in" section for the agent-as-connector pattern.

## Hard rules

**The honesty contract is load-bearing — never soften it.** The engine *does not know when it
does not know*: a returned result is **ranked text for the query, not evidence that an answer
exists**, and `score` is a **fused rank score, not a probability** (comparable within one
result set, meaningless across queries). This is stated in the CLI output and the API — keep
the wording consistent across the CLI, the `/v1/search` response + OpenAPI description, and the
README. Publishing the engine's limits is deliberate positioning, not a rough edge to polish
away.

**Evidence over assertion for anything ranking-related.** `rrfK` defaults to **10**
(`search/hybrid.ts`). Every performance/quality claim needs a committed artifact under
`benchmarks/results/`; negative results get committed too. Do not change the default ranking,
`rrfK`, or the fusion weights without a before/after artifact proving it.

**Do not edit the committed benchmark fixture.** `examples/sample-wiki/content/` and
`benchmarks/retrieval/sample-wiki.questions.jsonl` are the deterministic gate — create a *new*
fixture rather than mutating them.

**This fixture is saturated, so it cannot show that a change improved ranking.** Per this repo's
own committed artifacts, the real-embedding profile sits at recall@5 `.96`, recall@10 `.98`,
candidate recall `.98` (`remember-v0.3.0-fast-local-bge.json`), and the `ci` hash profile at
recall@10 `.927` (`remember-v0.3.0-ci-hash.json`). Candidate recall `.98` is the tell: the
retriever already reaches nearly every gold document, so a ranking change has almost nothing
left to win, and a 25-document corpus makes retrieval close to free. The fixture is the right
instrument for proving a change left ranking *unchanged* — that is how the `index.formats`
default and the 0.3.1 dependency bumps were verified — and the wrong one for claiming a gain.
An improvement claim needs a fixture with measurable headroom; if none is committed here, report
the change as unmeasured rather than quote a number this fixture cannot support.

**Markdown by default; other formats are opt-in, and there are exactly THREE parsers.**
`parsers/remark.ts` handles markdown. `parsers/pdf.ts` handles `.pdf` via
`@firecrawl/pdf-inspector`. Everything else — `.docx`/`.doc`/`.docm`, PowerPoint, Excel,
OpenDocument, `.rtf`, `.epub`, `.csv` — goes through `parsers/anydoc.ts`
(`@firecrawl/anydoc`). Both natives are MIT, optional **peer** deps, lazy-imported, local
Rust/napi — no network, no API key, no model.

Do **not** add a fourth parser, and do **not** collapse pdf into anydoc. Both emit markdown,
so a *new* format is an entry in `ANYDOC_FORMAT_EXTENSIONS`, not a new extraction
implementation. PDF is separate on purpose: pdf-inspector exposes page classification
(`TextBased`/`Scanned`/`ImageBased`/`Mixed`), per-page OCR flags, font-encoding warnings and
a recoverable document title. anydoc wraps the *same library* and surfaces none of it — it
raises an unsupported error for a scanned PDF instead of reporting why the text is missing.

`index.formats` defaults to `['md']`, and that default is load-bearing: an unconfigured
install walks, parses and indexes exactly what it did before. Verified — the `ci` gate
reproduces `recall@1/5/10 0.507/0.853/0.927`, MRR `0.853`, unchanged `corpus_hash`, against
`benchmarks/results/remember-v0.3.0-ci-hash.json`. The one behaviour change on the default
path: the md format claims `.markdown` as well as `.md`, which the old walker skipped (no
`.markdown` file exists in this repo, so no artifact moved).

Notes that will bite if you miss them:
- **`normalizeAnydocMarkdown` is load-bearing, not tidying.** Without `remark-gfm` a GFM
  table is not a table, so anydoc's `| --- | --- |` delimiter rows would be indexed as
  literal text; it also emits an empty header row for header-less tables. The normalizer
  flattens tables to `a | b | c` rows, strips list markers, backslash-escapes a leading `#`
  in flattened cell text (else a cell becomes a phantom heading), and collapses the title
  EPUB carries twice. Do not "simplify" it by feeding raw anydoc output to remark.
- **anydoc throws on bad data** ("unsupported input: …") for corrupt and mislabeled files.
  `parsers/anydoc.ts` catches all of it and degrades to an empty recorded page plus a warning
  naming the file. `parsers/pdf.ts` holds the same never-throw contract for scanned, corrupt
  and encrypted PDFs. Keep both: an ordinary scanned PDF must not turn into an indexing
  error.
- **PDF is native-text only.** `Scanned`/`ImageBased` need OCR (out of scope) and are
  recorded as empty pages with a warning naming the file; `Mixed` indexes its text pages and
  notes the rest. `pagesNeedingOcr` is a per-page *reliability* flag, NOT a "content dropped"
  signal — pdf-inspector sets it on clean text PDFs too — so it drives no warning; only an
  empty extraction does. `PdfParserOptions.maxBytes` (20 MiB) bounds the *synchronous,
  uninterruptible* native parse.
- **The hosted `/parse` OCR fallback is deliberately not wired.** It is a cloud call, and
  this engine's conversion stays local.
- **Spreadsheets and `.odp` retrieve poorly by nature**, not by bug. A sheet is one line per
  row; ODF presentations carry no heading semantics (text boxes are `draw:frame`), so
  `heading_path` is empty where `.pptx` populates it. Both are pinned in
  `tests/parser-anydoc.test.ts` under "documented limits".
- The walker now takes `extensions`/`binaryExtensions` and yields `string | Uint8Array`;
  `createIndexer` accepts either the legacy `Parser` or a `DocumentParser`. Always source
  both extension lists from `createFormatRouter()` so walker and parser cannot drift, and
  pass `binaryExtensions` to `createIndexer` too — `indexOne` reads files itself.

## Things that look inert but are intentional — do NOT "tidy" them

- **`query-planners/passthrough.ts` and `rerankers/none.ts`** are deliberate no-op seams: the
  query path is built so a real planner / cross-encoder reranker *could* slot in, and the OSS
  engine ships the passthrough/none versions on purpose. Don't delete the seams or the
  `@deprecated`/placeholder markers in `search/`.
- **`lexicalTieBreak`** (`search/hybrid.ts`, default `false`) is an opt-in tie-breaker that only
  reorders exact fused-score ties. It is off by default **on evidence** (measured net-neutral on
  the bundled corpus). Don't flip the default without a benchmark on harder fixtures.

## The `/v1/search` contract

Each result carries a fixed field set — `path, title, snippet, score, frontmatter,
heading_path, retrievers, chunk_id` — enforced by a whitelist projection, not a spread of the
internal result. Don't widen it casually. `GET /v1/capabilities` (and `remember capabilities`)
expose a stable, versioned discovery object for agents from one source of truth — keep it in
step with what the engine actually does.

## Open-core boundary

This repo is the **MIT basic engine** and stays that way. When a sibling repo's copy says
"`@useremember/core` is MIT," that is a true statement about **this** package — don't "fix" it
to something else. Keep pro-only concepts out of this codebase and its docs.

## Dev / build / test

```bash
pnpm install
pnpm build       # tsc
pnpm typecheck
pnpm test        # full suite
# benchmark harness:
pnpm --filter @useremember/core benchmark -- --help
```

## Measured operating cost (0.3.1)

Real 496-document Markdown vault, 2.3 MB, macOS ARM / Node 20 /
`bge-small-en-v1.5`. Re-measure before quoting these anywhere.

| | |
|---|---|
| Full index | 113 s → 3,117 chunks |
| `index.db` | 11 MB (4.6× the source markdown) |
| Peak RSS | **1.75 GB** |
| One file changed | 360 ms (0.3% of a full index) |
| One file deleted | 42 ms |
| Search | p50 6 ms warm; 133 ms first query (model load) |

**The memory is native, not V8.** `--max-old-space-size=512` still completes and
still peaks near 1.8 GB, because the ONNX runtime allocates outside the JS heap.
`OMP_NUM_THREADS` / `ORT_NUM_THREADS` do not move it either (1.80 GB vs 1.65 GB,
identical wall time — transformers.js does not appear to honour them). It is
also nearly flat in corpus size: ~0.7 GB for 3 documents, ~1.15 GB from 60 to
250, 1.75 GB at 496. So it is a fixed floor, not a leak — treat ~2 GB as the
indexing requirement and say so to anyone sizing a container.

If that floor ever needs to come down, the lever is model dtype, not batching:
`--embedder-dtype` already exists on the benchmark CLI, and a quantized
`bge-small` would cut model memory. **That is a retrieval study, not a config
change** — it alters embeddings, so it needs a `PIPELINE_REV` bump, a full
re-index, and a before/after artifact under `benchmarks/results/`.
