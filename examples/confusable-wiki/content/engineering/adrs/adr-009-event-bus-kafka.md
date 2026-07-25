---
title: "ADR-009: Kafka (MSK) as the internal event bus"
tags: [adr, events, kafka, messaging, engineering]
owner: platform
status: rejected
date: 2025-08-14
---

# ADR-009: Kafka (MSK) as the internal event bus

## Status

**Rejected — 2025-09-02.** This proposal was written, prototyped, and then declined. It is kept because the prototype's benchmark numbers still get cited, and because people keep re-proposing Kafka without reading why we said no. The internal event bus decision that actually shipped is ADR-013.

## Context

Services were communicating through direct HTTP calls and a Postgres outbox table polled once per second. Fan-out to more than two consumers meant either duplicating the outbox poll or adding another synchronous hop, and end-to-end propagation was measured at 1.2 to 4 seconds.

## Proposal

Adopt Amazon MSK as the single internal event bus. Topics per bounded context, three partitions minimum, `acks=all`, 7-day retention, and schema management through a Glue-backed registry with Avro payloads.

## Prototype results

The prototype was real and it worked. Median publish-to-consume latency was 42 ms at 8,000 events per second, and a forced broker restart cost 11 seconds of consumer lag with zero loss.

## Why it was rejected

- **Operational weight.** Partition planning, consumer-group rebalancing, and registry compatibility rules were judged too much surface for a four-person platform team with no dedicated streaming on-call.
- **Cost.** The three-broker MSK footprint plus the registry priced out at roughly 4.1x the alternative for our volume.
- **Avro toolchain friction.** Two of our runtimes had poor codegen support, and the workarounds reintroduced hand-written serializers.

Nothing here says Kafka is wrong at a larger scale. If sustained volume passes roughly 50,000 events per second or we hire streaming ownership, this ADR should be reopened rather than rewritten from scratch.

## Successor

See ADR-013 for the accepted design.
