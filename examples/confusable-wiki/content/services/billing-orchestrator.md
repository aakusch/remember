---
title: billing-orchestrator
tags: [service, billing, invoicing, current]
owner: billing
status: current
since: 2026-02-03
replaces: services/billing-gateway-legacy.md
---

# billing-orchestrator

**Current owner of billing.** Since 2026-02-03 this service owns invoice generation, proration, dunning, and revenue events. It replaces [billing-gateway (legacy)](./billing-gateway-legacy.md), which still issues invoices for 41 grandfathered annual contracts until its 2026-09-30 decommission.

## Responsibilities

- Generate invoices on the tenant's billing anniversary, in the tenant's currency and timezone
- Compute proration on plan and seat changes, mid-cycle in both directions
- Run dunning: retry a failed charge on days 1, 3, 7, and 14, then suspend
- Publish revenue events onto the event bus for the warehouse and for finance reconciliation

## Design notes

Written in TypeScript, deployed as an API surface plus a scheduler worker. Every externally visible operation is **idempotent on a caller-supplied key** held for 30 days, because dunning retries and provider webhooks both arrive more than once.

Events are published to `orbit.billing.*` subjects on the JetStream cluster described in [ADR-013](../engineering/adrs/adr-013-event-bus-nats.md). Delivery is at-least-once, so downstream consumers dedupe on `event_id`.

Money is stored as integer minor units with an explicit currency; there are no floats anywhere in the service, enforced by a lint rule.

## Reconciliation

A nightly job compares the provider's charge ledger against local invoice state and files a discrepancy record for anything that does not match, rather than auto-correcting. Finance triages the records. During the legacy overlap the same job also reconciles rows written directly by `billing-gateway`.

## Operational notes

- Invoice generation is the only path that may write to the invoices table for post-2025-07-01 contracts
- A stuck scheduler is a SEV2, not a SEV1 — billing is asynchronous and a few hours of delay has no user-visible effect
- Provider outages are absorbed by the retry schedule; do not manually re-drive charges, that is how you double-bill
