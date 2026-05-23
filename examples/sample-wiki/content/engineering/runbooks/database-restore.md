---
title: Database restore runbook
tags: [runbook, database, postgres, ops]
owner: platform
severity: high
status: tested
last_drill: 2026-04-12
---

# Database restore runbook

When to use this: the primary Postgres database is corrupted, unreachable for >15 minutes, or accidentally truncated. **Do not run these steps without paging the on-call lead first.**

## Prerequisites

You need:

- AWS console access (role: `platform-restore`)
- SSH access to the bastion (verify your key works *before* an incident)
- pgcli installed locally
- The current restore credentials from 1Password vault `prod/db`

## Procedure

### 1. Confirm the scope

Before touching anything, answer:

- Is data loss confirmed, or is this a connectivity issue?
- What's the latest known-good restore point?
- Are writes still happening to the primary? If yes, halt them first.

### 2. Halt new writes

```bash
# Set the platform to read-only mode via feature flag
flag set platform.read_only true
```

Verify in #incidents Slack that all team leads acknowledge.

### 3. Snapshot identification

In AWS RDS console, find the snapshot list. We take a snapshot every 6 hours plus a daily long-retention. Pick the most recent snapshot before the corruption window.

### 4. Restore to a new cluster

**Never restore over the existing primary.** Restore to a new cluster named `prod-restore-YYYYMMDD-HHMM`.

```bash
aws rds restore-db-cluster-from-snapshot \
  --db-cluster-identifier prod-restore-${DATE} \
  --snapshot-identifier ${SNAPSHOT_ID} \
  --engine aurora-postgresql
```

Wait for the cluster to reach `available` state (typically 15-25 minutes).

### 5. Verify data integrity

Connect to the restored cluster and run the verification queries from `scripts/db-verify.sql`. These check:

- Row counts on the 5 largest tables
- Latest timestamps on `events`, `audit_log`, `payments`
- Schema version matches what production expects

### 6. Cutover

Once verified:

1. Update Route53 to point `db.internal` at the new cluster
2. Restart the application tier so connection pools pick up the new endpoint
3. Re-enable writes: `flag set platform.read_only false`

### 7. Postmortem

Within 48 hours: write up timeline, root cause, contributing factors, and follow-up actions. File under `incidents/YYYY-MM-DD/`.

## Drill cadence

We test this runbook quarterly. Last drill: 2026-04-12 — completed in 47 minutes (target: <60 minutes for the full procedure).
