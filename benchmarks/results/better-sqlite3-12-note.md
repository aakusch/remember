# better-sqlite3 ^11 → ^12 — 2026-09-03

## Why

`better-sqlite3@^11.3.0` had no prebuilt binary for current Node, so a fresh install fell
through to `node-gyp rebuild` and required a working C++ toolchain. That is an
install-*success* problem, not only a size one: a user without build tools cannot install the
engine at all, and the failure surfaces as a compiler error rather than anything actionable.

`^12` publishes prebuilds for current Node, so `prebuild-install` succeeds and the toolchain
requirement disappears.

## Measured

Clean `npm install <pkg> --omit=dev` into an empty project, darwin-arm64, Node v25.8.1:

| | resolved | `node_modules` |
|---|---|---|
| `better-sqlite3@^11.3.0` | 11.10.0 | 29 MB |
| `better-sqlite3@^12` | 12.11.1 | **14 MB** |

−15 MB, and the workspace install resolved through `prebuild-install` rather than `node-gyp`.

## Ranking invariance

`better-sqlite3` is the storage layer — it backs both retrieval arms (FTS5 for BM25 and the
`sqlite-vec` extension for vectors), so a major bump has to be proven not to move ranking
rather than assumed. Extension loading in particular is a real risk across a major.

`remember-v0.3.1-ci-hash-better-sqlite3-12.json` was run on the committed `sample-wiki` fixture
at `--profile ci --candidate-k 20`. `corpus_hash` and `questions_hash` match, and **every
summary metric is identical** to both `remember-v0.3.0-ci-hash.json` and
`remember-v0.3.1-ci-hash-dep-hardening.json` — recall@1/5/10 `.507`/`.853`/`.927`, candidate
recall `.940`, MRR `.853`, nDCG@5/10 `.833`/`.849`, empty/wrong-source `.000`/`.367`.

324 tests pass, typecheck and build clean, `pnpm audit --prod` reports no vulnerabilities. The
suite indexes and searches real stores, so `sqlite-vec` extension loading is exercised.

This is the correct use of a saturated fixture: proving a change left ranking unchanged.

## What was deliberately NOT changed

From the Wave 2 weight budget (`remember-pro-next/docs/weight-budget-2026-09-03.md`), three
further items were considered and rejected *for this repo*:

- **`sharp` override `0.35.3` → `0.35.4`.** The override here already pins `0.35.3`, which is
  past the libvips advisory (patched `>=0.35.0`), and `pnpm audit` reports it clean. The "clears
  3 highs" measurement was taken against a semantic install carrying **no** override, so it does
  not describe this tree. No evidence, no change.
- **Dropping `onnxruntime-web` (−91 MB) and pruning foreign ONNX platform binaries (−177 MB).**
  Both live under `@huggingface/transformers`, an *optional peer* dependency. A published
  library cannot override a consumer's transitive dependency, and reaching into a peer's
  installed files from a `postinstall` would be undone by any reinstall and would break a user
  who later runs on a different platform. All those measurements are darwin-arm64 only. These
  are operator guidance for whoever installs the semantic stack, not packaging changes here.
- **Switching the default embedder to a q8 model repo (−95 MB).** A ranking change. It needs a
  before/after artifact on the unsaturated fixtures first, and this fixture cannot support it.
