---
title: Architecture overview
tags: [engineering, architecture, system-design]
owner: platform
status: stable
updated: 2026-05-23
---

# Architecture overview

This document describes how our platform is structured at a high level.

## Layers

We separate concerns into four layers:

1. **Edge** — CDN + WAF + DDoS protection. Sits in front of every request.
2. **Application** — stateless Node.js services behind a load balancer. Horizontal autoscaling on CPU and request queue depth.
3. **Data** — PostgreSQL primary with two read replicas, Redis for hot cache, S3 for object storage.
4. **Async** — a job queue (BullMQ on Redis) handles background work: emails, exports, reindex, billing reconciliation.

## Request lifecycle

A typical authenticated API call:

1. Client → Edge (TLS termination, header normalization)
2. Edge → Application (origin pull, ~3ms)
3. App reads session from Redis, attaches user context
4. Handler executes; may query Postgres or write a job to BullMQ
5. Response → Edge → Client

P50 latency target is 80ms end-to-end, P99 is 400ms. We page on sustained P99 above 800ms.

## Data flow

- **Writes** go to the Postgres primary. Read-after-write consistency is preserved within a session.
- **Reads** hit one of two replicas via PgBouncer in transaction-pool mode.
- **Hot keys** (session tokens, feature flags, user metadata) are cached in Redis with 5-minute TTL.

## Backwards compatibility

All API surface is versioned via URL prefix (`/v1`, `/v2`). We do not remove or change the semantics of existing endpoints; we add new versions and deprecate old ones with a 12-month sunset.

## Decisions

For load-bearing architectural choices, see the [ADR series](./adrs/). New decisions get their own ADR before code lands.

## Related

- [Code style](./code-style.md)
- [Deploy runbook](./runbooks/deploy.md)
- [Database restore runbook](./runbooks/database-restore.md)
