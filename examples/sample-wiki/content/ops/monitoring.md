---
title: Monitoring & alerts
tags: [ops, monitoring, observability, grafana, prometheus]
owner: ops
status: stable
---

# Monitoring & alerts

What we monitor, where it lives, and what alerts on what.

## Stack

- **Prometheus** for metrics scraping
- **Grafana** for dashboards
- **Alertmanager** routes alerts to PagerDuty (SEV1/2) and Slack #alerts (SEV3)
- **Loki** for logs
- **Tempo** for distributed traces

All three sit behind the same Grafana instance — links between metric, log, and trace are click-to-jump.

## Golden signals

Every service publishes the four golden signals:

1. **Latency** — request duration histogram, P50/P95/P99
2. **Traffic** — requests per second
3. **Errors** — error rate (5xx + un-handled exceptions)
4. **Saturation** — CPU, memory, queue depth

These show up in the standardized service dashboard at `grafana.internal/d/service/<name>`.

## Alert hierarchy

Alerts are tiered:

- **Pages** — wake someone up. Reserved for user-impacting issues confirmed by a symptom (not a leading indicator).
- **Tickets** — created in Jira automatically. For trends that need attention but aren't urgent.
- **Slack notifications** — informational. Goes to #alerts.

Rule of thumb: if an alert pages but nothing is actually broken from the user's perspective, the alert is wrong. Tune it down to a ticket.

## Key dashboards

- `prod-overview` — top-level service health
- `prod-canary-error-rate` — canary deploys
- `prod-database` — Postgres + Redis health
- `prod-queue` — BullMQ queue depths
- `prod-third-party` — uptime of vendors we depend on (Stripe, Sendgrid, S3)

## SLOs

We publish SLOs for the three customer-facing services:

| Service | Latency P99 | Availability |
|---|---|---|
| API | 800ms | 99.95% |
| Web | 2s (Largest Contentful Paint) | 99.9% |
| Background jobs | n/a | <5min queue depth at P95 |

Burning more than 2% of the monthly error budget in a week triggers an SLO review.

## On-call tooling

- PagerDuty: `paging` rotation `platform-prod`
- Runbook links in every alert
- Pinned Grafana dashboard in #alerts

## Related

- [On-call](./on-call.md)
- [Incident response](./incident-response.md)
- [Architecture overview](../engineering/architecture-overview.md)
