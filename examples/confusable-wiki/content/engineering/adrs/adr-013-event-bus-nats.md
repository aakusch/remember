---
title: "ADR-013: NATS JetStream as the internal event bus"
tags: [adr, events, nats, messaging, engineering]
owner: platform
status: current
date: 2025-09-19
---

# ADR-013: NATS JetStream as the internal event bus

## Status

**Accepted — 2025-09-19. This is the internal event bus.** It replaces the Postgres outbox polling pattern and was chosen over the Kafka proposal in ADR-009.

## Decision

All cross-service events flow through a three-node NATS JetStream cluster per region.

- **Subjects** are namespaced `orbit.<context>.<entity>.<verb>`, for example `orbit.billing.invoice.finalized`.
- **Delivery is at-least-once.** Every consumer must be idempotent; we key on the `event_id` header and keep a 24-hour dedupe window.
- **Stream retention is 7 days**, limits-based, with a 200 GB per-stream cap.
- **Payloads are JSON** validated against JSON Schema in the shared `contracts` package. No binary schema registry.
- Consumers are durable pull consumers with explicit acknowledgement and a 30-second ack wait.

## Ordering

Ordering is guaranteed only per subject, and only for a single publisher. Anything that needs a total order across entities must derive it from a database sequence, not from the bus.

## Operational notes

Cluster health is a single dashboard: consumer lag, redelivery count, and stream bytes. The alert that matters is redelivery rate, because it almost always means a consumer is throwing after partial work.

Replay is a supported operation. `nats consumer next` against a fresh durable name replays from any sequence inside the retention window; this is how the search index is rebuilt.

## Consequences

**Positive:** one binary to operate, propagation latency dropped to under 80 ms at p99, and JSON Schema fits the toolchain we already had.

**Negative:** no infinite log, so anything needing history beyond 7 days must snapshot to object storage. Cross-region mirroring is manual and has bitten us once during a region drain.
