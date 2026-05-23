---
title: Code style
tags: [engineering, style, typescript]
owner: platform
status: stable
---

# Code style

Conventions for new code. Existing code that pre-dates these rules gets brought into compliance opportunistically — don't block a PR on style alone.

## TypeScript

- **Strict mode is non-negotiable.** `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch` all on.
- **No `any`.** Use `unknown` and narrow with type guards. If you genuinely need to cast, name the assertion with a comment explaining why.
- **Prefer `type` over `interface`** unless you need declaration merging.
- **Discriminated unions** for state — never store a state flag separately from its payload.
- **Named exports only.** Default exports break tooling and grep.

## Async

- **No callback APIs.** Always Promises + async/await.
- **Wrap third-party callback APIs** with `util.promisify` or a thin adapter.
- **Cancel propagation:** every long-running async function accepts an `AbortSignal`.
- **Never swallow errors.** `catch` blocks must either rethrow, log with structured context, or convert to a typed error result.

## Naming

- `camelCase` for variables, functions, properties.
- `PascalCase` for types, classes, React components.
- `SCREAMING_SNAKE` for module-level constants that are truly constant.
- `kebab-case` for filenames; one type or component per file.

## Imports

- Standard library first, then external packages, then internal modules (sorted by path depth).
- Absolute imports via the tsconfig `paths` alias `@/`.

## Comments

- **Default to no comments.** Self-explanatory names beat comments.
- **Write comments for the why, not the what** — explain non-obvious tradeoffs, hidden invariants, surprising behavior.
- **No commented-out code.** Delete it; git remembers.

## Tests

- Co-locate tests next to source as `*.test.ts`.
- Each test should be independently runnable; no shared mutable state.
- Use the AAA pattern: Arrange, Act, Assert.
- Mock only what you cross a network or process boundary for. Don't mock your own code.

## Pull requests

- One logical change per PR. If you're tempted to add a "while I'm here" cleanup, that's a separate PR.
- Title in imperative mood: "Add X" not "Adding X" or "Added X".
- PR description includes a "Why" section. The diff already shows "What".
