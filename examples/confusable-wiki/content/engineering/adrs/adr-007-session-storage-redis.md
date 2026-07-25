---
title: "ADR-007: Server-side sessions in Redis"
tags: [adr, auth, sessions, redis, engineering]
owner: identity
status: superseded
date: 2024-11-06
superseded_by: ADR-011
---

# ADR-007: Server-side sessions in Redis

## Status

**Superseded by ADR-011 (2026-01-22).** Do not cite this page as the current session design. It is retained because two legacy admin tools still hold Redis-backed sessions during their migration window, and incident timelines from 2025 reference this behaviour.

## Context

In late 2024 the API had no shared session concept. Each service re-validated the user's password-derived cookie against the users table, which put roughly 4,000 reads per second on the Postgres primary at peak and made every service a potential credential-handling surface.

## Decision

Sessions are opaque server-side records stored in Redis. The browser receives only a random 32-byte session identifier in an `HttpOnly` cookie.

- Session TTL is **30 days, sliding** — every authenticated request extends the expiry.
- The load balancer uses sticky sessions so that a warm local cache in front of Redis stays useful.
- Logout deletes the Redis key, so revocation is immediate and total.
- Session payload holds user id, tenant id, and the roles snapshot taken at login.

## Consequences

**Positive:** revocation is trivial, the primary database is no longer in the auth hot path, and the cookie carries no claims that could go stale.

**Negative:** Redis becomes a hard availability dependency for every authenticated request — a Redis failover in March 2025 logged out every user on the platform. Sticky sessions also fight against fast autoscaling, because draining an instance means draining its warm cache.

## Why this was replaced

The availability coupling was the deciding factor, together with the roles snapshot going stale for up to 30 days after a permission change. See ADR-011 for the replacement design and the migration plan.
