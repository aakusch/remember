---
tags: [reference, obsidian]
---

# Architecture Decisions

Quick index of major architecture decisions, with pointers to the full ADRs.

## Accepted

- **TypeScript strict mode** — locks in strict null checks, no implicit any. See ADR-001.
- **pnpm-workspaces monorepo** — consolidated three repos into one. See ADR-002.
- **Hybrid BM25 + vector search** — adopted from `tobi/qmd`. RRF fusion of FTS5 + sqlite-vec retrievers.
- **Local-first embeddings by default** — [BGE Embedding Models](./bge-embedding-models) runs in-process via ONNX runtime.

## Proposed

- API v3 — rejected for now, see [Roadmap Draft](./roadmap-draft)
- Mobile native rewrite — accepted, in progress

## Process

New ADRs follow a template: Status, Context, Decision, Consequences, Alternatives. Land them before the implementation PR.
