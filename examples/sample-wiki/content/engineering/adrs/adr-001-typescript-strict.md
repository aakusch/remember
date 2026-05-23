---
title: "ADR-001: TypeScript strict mode is mandatory"
tags: [adr, typescript, engineering]
owner: platform
status: accepted
date: 2025-09-14
supersedes: null
superseded_by: null
---

# ADR-001: TypeScript strict mode is mandatory

## Status

Accepted — 2025-09-14.

## Context

We started this codebase in early 2024 with TypeScript in non-strict mode to make the migration from JavaScript faster. Two years in, the cost is showing:

- ~600 `any` casts in the codebase, growing ~20/week
- 14 runtime null-pointer bugs in 2025 that strict null checks would have caught at compile time
- New engineers can't tell what's safe to refactor because the type system isn't reliable

## Decision

**All new TypeScript files must compile under strict mode.** We enabled the `strict: true` compiler flag plus `noUncheckedIndexedAccess` and `noFallthroughCasesInSwitch`.

Existing files are migrated opportunistically — whoever touches a file is responsible for bringing it to strict compliance as part of their change. We do not block changes on unrelated cleanup, but we do not allow new code that wouldn't compile under the new rules.

## Consequences

**Positive:**
- Type errors caught at compile time instead of in production
- IDE autocomplete becomes trustworthy
- Refactoring is safer

**Negative:**
- Migration is slow and painful for the largest files
- Some third-party type definitions are incomplete; we maintain a `types/external.d.ts` for gaps
- Test mocks become harder to write — solved by introducing typed test helpers

## Alternatives considered

- **Big-bang migration:** rejected, would block all other work for ~3 weeks
- **Strict mode only for new packages:** rejected, fragments the codebase further
- **Looser settings (just `noImplicitAny`):** rejected, doesn't catch the null bugs

## Migration tracking

See the `strict-mode` GitHub project for the per-file checklist.
