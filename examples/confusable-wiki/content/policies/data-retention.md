---
title: Data retention policy
tags: [policy, retention, privacy, compliance]
owner: legal
status: current
version: 3
effective: 2026-03-01
---

# Data retention policy

**Active policy, version 3, effective 2026-03-01.** It replaces the [2023 retention policy](./archive/data-retention-2023.md), which is archived and applies only to periods before this effective date. Every window below shortened relative to that version; do not mix the two.

## Retention windows

| Data class | Retention | Enforced by |
| --- | --- | --- |
| Request and access logs | **30 days** | log pipeline lifecycle rule |
| Audit events (security-relevant actions) | **7 years** | append-only audit store |
| Product analytics events | **13 months** | warehouse partition drop |
| Database backups | **35 days** | snapshot lifecycle |
| Support ticket contents | 3 years after close | helpdesk retention setting |
| Deleted tenant data | **purged within 30 days** of deletion request | scheduled purge job |

## Deletion requests

A tenant deletion request starts a 7-day reversible window (soft delete), after which the purge job removes primary records, derived warehouse rows, and search index documents. Backups are the exception: they age out on their own 35-day cycle, so residual copies may exist for up to 35 days after purge. This is disclosed in the data processing addendum.

## Audit events are special

Audit events are never deleted early, not even by a tenant deletion request. They are stored with tenant identifiers pseudonymised after purge so the record of *what happened* survives without the personal data. Anyone proposing a shorter audit window needs legal sign-off, not just engineering.

## Enforcement and evidence

Each window is implemented as infrastructure configuration, not a cron job someone remembers to run. The quarterly compliance review samples one object per data class and proves it aged out on schedule. Failures are tracked as findings with an owner and a date.

## Common mistake

Staging retains request logs for only 3 days, which is shorter than this policy requires for production. That is intentional and not a violation — the policy floor applies to production data.
