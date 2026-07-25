---
title: "ADR-004: Date-based API versioning"
tags: [adr, api, versioning, engineering]
owner: api-platform
status: current
date: 2024-06-11
---

# ADR-004: Date-based API versioning

## Status

Accepted — 2024-06-11, still current. No successor.

## Context

The public API started with a `/v1/` path prefix. Within a year we had four backwards-incompatible changes we wanted to make and no way to make any of them, because bumping to `/v2/` would have forced every integrator to migrate everything at once for changes that touched two endpoints.

## Decision

Versions are **dates, pinned per client, sent in a header**:

```
Orbit-Version: 2026-03-01
```

- A client's first successful call pins it to the newest version available at that time. The pin is stored on the API key.
- Every breaking change ships as a new dated version plus a **request transformer** that upgrades older-shaped requests and downgrades newer-shaped responses.
- Transformers are chained, so a client on `2024-06-11` still works through nine intervening versions.
- Non-breaking additions (new optional fields, new endpoints) never create a version.

## What counts as breaking

Removing or renaming a field, narrowing an accepted type, adding a required request field, changing pagination semantics, or changing an error code's meaning. Adding an enum value is breaking **only** for fields the client is documented to switch on exhaustively.

## Consequences

**Positive:** integrators migrate on their own schedule, and each transformer is small enough to test exhaustively. Support can reproduce a customer's exact behaviour by replaying with their pinned version.

**Negative:** the transformer chain is permanent work. We cap it at 24 months — versions older than that get a deprecation notice, a migration guide, and a hard cutoff. Two transformers currently carry logic nobody wants to touch; both are covered by golden-file tests.

## Client guidance

Server SDKs pin explicitly at build time. Browser and mobile clients must send the header on every request rather than relying on the API-key pin, so that a shared key does not drag one platform onto another's version.
