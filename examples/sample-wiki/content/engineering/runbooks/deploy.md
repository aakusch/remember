---
title: Deploy runbook
tags: [runbook, deploy, ops]
owner: platform
severity: medium
status: stable
---

# Deploy runbook

Standard production deploy. For emergency hotfixes, see [Rollback](./rollback.md) — the procedures diverge after step 3.

## Pre-flight checklist

Before merging to `main`:

- [ ] CI green on the feature branch
- [ ] At least one approving review
- [ ] Migrations (if any) have been dry-run on a staging clone
- [ ] No active incident on the #incidents channel
- [ ] Not within an active deploy freeze (check the calendar)

## Deploy steps

### 1. Merge to main

Use the GitHub "Squash and merge" button. CI re-runs on the merged commit; wait for it.

### 2. Tag and release

Our deploy is triggered by pushing a semver tag:

```bash
git tag v$(date +%Y.%m.%d).$(git rev-list --count HEAD)
git push origin --tags
```

This kicks off the deploy pipeline in GitHub Actions.

### 3. Watch the canary

The pipeline rolls 10% of traffic to the new version first. Watch:

- Error rate dashboard (Grafana: `prod-canary-error-rate`)
- Latency P99 (must stay under 800ms)
- Custom feature metrics (depends on what shipped)

If anything regresses, hit "Halt canary" in the pipeline UI. Continue to full only when canary has been clean for at least 10 minutes.

### 4. Full rollout

Click "Proceed to full". This rolls the remaining 90% over 5 minutes.

### 5. Post-deploy verification

After full rollout completes:

- [ ] Smoke-test the critical user flows from the test plan
- [ ] Check that background workers picked up the new version (BullMQ dashboard)
- [ ] Verify migrations applied cleanly (`psql prod -c '\dt'`)
- [ ] Post in #releases: "Deployed v$TAG · what shipped · @oncall is watching"

## What can go wrong

- **Migration deadlock:** rare. If it happens, the deploy auto-rolls back. See [Database restore](./database-restore.md) only if data is corrupted.
- **Bad config:** the deploy will fail health checks and roll back automatically.
- **Slow rollout:** if the pipeline stalls at the canary stage for >20 minutes without alarms firing, check that the canary actually has traffic (look at the LB target group).

## Drill notes

We deploy 8-12 times per week. Most deploys are uneventful. The runbook only matters when something goes wrong — read it now, not during the incident.
