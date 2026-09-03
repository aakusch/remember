# Dependency hardening for the 0.3.1 release candidate — 2026-09-02

## Why

`0.3.1` is justified as a security and durability patch. At candidate commit `4f36caa` it
carried **11 production advisories (5 high, 5 moderate, 1 low)**. Publishing a security
release with high-severity advisories in its own production tree undercuts the justification,
so this had to be resolved before the publish decision.

## Root cause of the highest finding

The root `pnpm.overrides` block **pinned `js-yaml` to exactly `3.15.0`** — the version the
advisory names as vulnerable (quadratic CPU consumption in `!!omap` resolution). The pin was
holding the vulnerable version in place against `gray-matter`'s own permissive range. A pin
added to solve one problem became the source of another; re-audit pins, don't trust them.

## Change

All four are transitive patch-level bumps, expressed as root `pnpm.overrides`:

| Package | Was | Now | Reached via |
|---|---|---|---|
| `js-yaml` | `3.15.0` (pinned) | `3.15.1` | `gray-matter` |
| `fast-uri` | `3.1.5` | `3.1.6` | `@modelcontextprotocol/sdk` → `ajv` |
| `hono` | `4.12.32` | `4.12.34` | direct + `@modelcontextprotocol/sdk` |
| `qs` | `6.15.3` | `6.16.0` | `@modelcontextprotocol/sdk` → `express` |

Dev tooling: `vitest` `2.1.9` → `3.2.7`, which clears a **critical** advisory (arbitrary file
read while the Vitest UI server listens) plus a high in `vite`. `vitest@4.1.11` was tried and
**rejected** — it resolves against a stale `vite@5` peer and fails at startup with
`ERR_PACKAGE_PATH_NOT_EXPORTED` on `./module-runner`. Do not retry the 4.x jump without also
resolving that peer.

## Result

- `pnpm audit --prod`: **11 advisories → 0.** `pnpm run audit:prod` (gate: `--audit-level high`)
  now passes.
- Full tree including dev: 21 → 9, and the critical is gone. The remaining 9 are dev-only
  (`vite`, `esbuild`, `nanoid`, `postcss` under `vitest` 3.2) and do not ship in the package.
- 324 tests pass, typecheck clean, build clean, `npm pack` unchanged at 193 files / 190 KB.

## Ranking invariance

No ranking-path dependency changed — `js-yaml` parses frontmatter, `hono` serves HTTP, and
`qs`/`fast-uri` sit under the MCP transport. Proven rather than argued, per the repo's evidence
rule:

`remember-v0.3.1-ci-hash-dep-hardening.json` was run on the committed `sample-wiki` fixture at
`--profile ci --candidate-k 20`. `corpus_hash` and `questions_hash` match the committed
`remember-v0.3.0-ci-hash.json`, and **every summary metric is identical** — recall@1/5/10
`.507`/`.853`/`.927`, candidate recall `.940`, MRR `.853`, nDCG@5/10 `.833`/`.849`,
empty/wrong-source `.000`/`.367`.

Note that `sample-wiki` is saturated on real embeddings and can only detect a regression here;
it is the right instrument for an invariance claim and the wrong one for an improvement claim.
