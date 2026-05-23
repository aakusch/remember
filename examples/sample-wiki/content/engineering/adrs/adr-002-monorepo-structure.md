---
title: "ADR-002: Adopt a pnpm-workspaces monorepo"
tags: [adr, monorepo, tooling, engineering]
owner: platform
status: accepted
date: 2026-01-30
---

# ADR-002: Adopt a pnpm-workspaces monorepo

## Status

Accepted — 2026-01-30.

## Context

We had three separate repositories: `web-app`, `api-server`, `shared-types`. Cross-cutting changes required three PRs and coordinated deploys. The `shared-types` package was versioned via npm publish, so consumers were always at least one publish cycle behind.

## Decision

Merge all three repositories into a single pnpm-workspaces monorepo under `packages/*`. Shared code becomes a workspace package consumed via `workspace:*` rather than published versions.

We chose **pnpm** over npm or yarn because:
- Disk efficiency (content-addressed store)
- Faster cold installs on CI
- Strict module resolution by default (prevents phantom dependencies)
- First-class workspace protocol

We chose **a monorepo over polyrepo** because:
- One PR for a cross-cutting change
- Atomic deploys remove the "deploy ordering" failure mode
- Refactoring across package boundaries doesn't require coordinated releases

## Consequences

**Positive:**
- Type changes in shared code surface immediately, not in the next publish cycle
- One CI pipeline to maintain
- Easier to share dev tooling (eslint, prettier, tsconfig base)

**Negative:**
- The repo is now larger (~3x clone time)
- CI must be smart about only running tests for affected packages — we use turbo for this
- Branch policies must consider that one branch may contain changes to multiple deployables

## Alternatives considered

- **Stay polyrepo but adopt Changesets** for coordinated releases: rejected, doesn't solve the atomic-deploy problem
- **npm workspaces** instead of pnpm: rejected, less strict resolution, slower
- **Nx instead of turbo:** rejected, more configuration overhead for our scale

## Related

- [Architecture overview](../architecture-overview.md)
- [ADR-001: TypeScript strict mode](./adr-001-typescript-strict.md)
