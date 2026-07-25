---
title: "ADR-011: Stateless access tokens with rotating refresh tokens"
tags: [adr, auth, sessions, jwt, engineering]
owner: identity
status: current
date: 2026-01-22
supersedes: ADR-007
---

# ADR-011: Stateless access tokens with rotating refresh tokens

## Status

**Accepted — 2026-01-22. This is the current session design.** It supersedes ADR-007 (server-side sessions in Redis).

## Context

ADR-007 put Redis in the request path for every authenticated call, and a Redis failover in March 2025 signed out the entire user base. It also let a user keep stale roles for up to 30 days, because the roles snapshot was written once at login.

## Decision

Authentication issues two tokens.

- **Access token** — a signed JWT with a **15-minute** lifetime. Services verify it locally against the JWKS endpoint; no network call to the identity service and no Redis read.
- **Refresh token** — an opaque 32-byte value stored hashed in Postgres, valid for **14 days**, and **rotated on every use**. Presenting a refresh token that has already been used invalidates the whole token family and forces re-authentication.

Roles are not embedded in the access token. Services read the roles claim reference and resolve permissions from the authorization service, which is cached for 60 seconds.

## Revocation

Because access tokens are stateless, revocation is not instantaneous. We accept a **worst case 15-minute window** and mitigate it with a deny-list: the identity service publishes revoked token ids to an in-memory deny-list in every service, refreshed every 5 seconds. Refresh tokens are revoked synchronously in Postgres, so a compromised session cannot be extended.

## Consequences

**Positive:** no shared availability dependency for verification, permission changes take effect within a minute, and horizontal scaling no longer needs sticky sessions.

**Negative:** revocation is eventually consistent, and clients must implement refresh-and-retry. The mobile client's retry loop caused a thundering herd during the January rollout, fixed with jittered refresh.

## Migration

Two internal admin tools still hold ADR-007 Redis sessions; both are scheduled off by 2026-09-30. Until then the gateway accepts either credential and stamps which one was used in the access log.
