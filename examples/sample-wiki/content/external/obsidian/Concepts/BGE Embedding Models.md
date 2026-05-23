---
tags: [ai, embeddings, reference, obsidian]
---

# BGE Embedding Models

Notes on the BAAI/bge family of embedding models used in our AI search.

## Variants

| Model | Dim | Size | Notes |
|---|---|---|---|
| bge-small-en-v1.5 | 384 | ~80MB | Our default — best balance |
| bge-base-en-v1.5 | 768 | ~210MB | Better quality, slower |
| bge-large-en-v1.5 | 1024 | ~440MB | Best quality, large download |

## Why BGE over OpenAI

- Runs locally → privacy story for design partners like Northwind
- No per-token cost
- Quality is competitive on English content
- ONNX runtime is mature

## Tradeoffs

- English-only — multilingual support requires a different family
- Quality degrades on highly domain-specific content
- Initial download is ~80MB; some users on slow connections complain

See [Roadmap Draft](./roadmap-draft) for sequencing and [Architecture Decisions](./architecture-decisions) for related ADRs.
