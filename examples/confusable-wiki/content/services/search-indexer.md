---
title: search-indexer
tags: [service, search, opensearch, events, current]
owner: search
status: current
updated: 2026-06-18
---

# search-indexer

**Current.** This service keeps the OpenSearch cluster in sync with the source of truth by consuming events off the bus. There is no deprecated predecessor; the previous nightly cron reindex was deleted rather than kept.

## How indexing works

The indexer is a durable pull consumer on the JetStream subjects `orbit.*.*.created`, `.updated`, and `.deleted`, per [ADR-013](../engineering/adrs/adr-013-event-bus-nats.md). For each event it loads the current entity from the owning service's read API and writes the projected document, rather than trusting the event payload as the document body. Events carry identifiers and a version, not content.

Writes go through a version check: a document is only replaced if the incoming entity version is greater than the indexed one. This makes out-of-order delivery harmless, which matters because at-least-once delivery gives no cross-subject ordering.

## Lag SLO

Indexing lag — event publish to document visible — has a **60-second SLO at p99**. The alert fires at 120 seconds sustained for 5 minutes. Lag is almost always one of three things: a slow read API upstream, a poison event being redelivered, or a manual backfill competing for write capacity.

## Backfill and rebuild

```
orbitctl search backfill --entity invoice --since 2026-01-01
orbitctl search rebuild --index tenants --alias-swap
```

`rebuild` writes into a new index and swaps the alias at the end, so search stays available throughout. Never rebuild in place. Full rebuild of the largest index takes about 90 minutes and should be throttled with `--rate` if it starts pushing indexing lag past the SLO.

## Replay

Because streams retain 7 days, a bug that corrupted documents within that window can be fixed by deploying the fix and replaying from a sequence with a fresh durable consumer name. Older than 7 days, use `backfill` instead — the events are gone.

## Failure behaviour

If OpenSearch is unavailable the consumer stops acknowledging and lag grows; nothing is lost while the stream retains. Search reads degrade to an explicit "search unavailable" state rather than returning stale-but-plausible results silently.
