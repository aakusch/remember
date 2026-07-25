---
title: "billing-gateway (legacy)"
tags: [service, billing, legacy, decommission]
owner: billing
status: deprecated
replaced_by: services/billing-orchestrator.md
decommission_date: 2026-09-30
---

# billing-gateway (legacy)

**Deprecated and being decommissioned on 2026-09-30.** Invoice generation, proration, and dunning moved to [billing-orchestrator](./billing-orchestrator.md) in February 2026. Do not add features here and do not point new integrations at it. This page is the decommission checklist as much as it is service documentation.

## What it still does

Exactly one thing: it issues invoices for **legacy annual contracts signed before 2025-07-01** whose terms encode a custom mid-term true-up that the new proration engine intentionally does not model. There are 41 such contracts left; 34 renew onto standard terms before September.

It also still serves two read-only endpoints that a customer-facing PDF download depends on.

## Shape

Ruby 3.0, Sinatra, single deployment of 2 replicas, its own Postgres schema `billing_legacy`. No event publishing — it writes directly to the shared invoices table, which is why the orchestrator treats that table as read-mostly and reconciles rather than owning it outright.

## Frozen scope

The code is frozen. Accepted changes are limited to security patches and one-line data corrections approved in `#billing-legacy`. Two people can review; the author cannot self-approve here, unlike normal services.

## Decommission checklist

- [ ] Migrate the remaining custom true-up contracts (41 open, tracked in `BILL-2210`)
- [ ] Move the PDF download endpoints behind the orchestrator (`BILL-2244`)
- [ ] Backfill `billing_legacy` invoice history into the orchestrator's store
- [ ] Freeze writes, keep read traffic for 30 days, then delete the deployment
- [ ] Retain the schema as a snapshot per the [data retention policy](../policies/data-retention.md)

## If it pages you

There is no on-call rotation for this service. Alerts route to `#billing-legacy` and are handled next business day, because it processes a nightly batch and has no interactive traffic path that a user waits on.
