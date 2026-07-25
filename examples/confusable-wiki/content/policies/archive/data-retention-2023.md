---
title: "Data retention policy (2023 — archived)"
tags: [policy, retention, privacy, compliance, archive]
owner: legal
status: archived
version: 2
effective: 2023-04-01
superseded_by: policies/data-retention.md
---

# Data retention policy (2023 — archived)

**Archived.** This version was in force from 2023-04-01 until 2026-02-28 and is superseded by the [active data retention policy](../data-retention.md). Do not cite these windows as current. It is retained because audit requests and legal holds covering 2023 through 2025 are assessed against the policy that applied at the time.

## Retention windows as they stood

| Data class | Retention (this version) |
| --- | --- |
| Request and access logs | **90 days** |
| Audit events | **3 years** |
| Product analytics events | 25 months |
| Database backups | **180 days** |
| Support ticket contents | 5 years after close |
| Deleted tenant data | **purged within 90 days** of request |

## Why the windows were longer

The 2023 windows were set when log volume was a tenth of today's and storage cost was not material. Long retention was treated as free optionality for debugging. Two things changed that: storage cost grew faster than revenue for the logging tier, and a 2025 data protection review flagged 90-day request logs containing user identifiers as an unnecessary risk surface.

## Deletion process as it stood

Deletion requests were handled by a manual quarterly sweep. An engineer ran a script per data store and attached the output to a ticket. There was no reversible soft-delete window, which caused one incident in 2024 where a tenant asked to undo a deletion and we could only restore from a backup, losing eleven days of their data.

## If you are reading this for an audit

Map the period in question to the policy in force: anything before 2026-03-01 is judged by this page, anything on or after by the active policy. The transition was announced to customers on 2026-01-15 with a 45-day notice.
