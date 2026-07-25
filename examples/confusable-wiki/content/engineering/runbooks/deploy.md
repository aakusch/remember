---
title: Deploy runbook
tags: [runbook, deploy, release, canary, engineering]
owner: platform
status: current
updated: 2026-06-30
---

# Deploy runbook

**Current procedure.** Replaces the deprecated [Jenkins v1 runbook](./deploy-v1-jenkins.md), which was retired on 2026-02-28. If someone tells you about Tuesday/Thursday release windows or a release-manager approval gate, they are quoting the retired page.

## How production deploys happen

Merging to `main` deploys to production. There is **no release window, no freeze calendar, and no separate approval step** — the two-person pull-request review *is* the approval. Authors deploy their own changes and are expected to watch the rollout.

## Progressive rollout

Argo Rollouts shifts traffic in three steps with automated analysis between them:

1. **10%** for 5 minutes
2. **50%** for 5 minutes
3. **100%**

At each pause, the analysis template compares the canary against the stable pool on error rate (fails above 1.5x baseline), p99 latency (fails above 1.3x baseline), and a saturation check. A failed analysis aborts and shifts traffic back to stable automatically, usually within 40 seconds. You do not need to do anything for an automatic abort except read the analysis run.

## Manual rollback

If the canary passed but you know the release is bad:

```
gh workflow run rollback.yml -f service=<service> -f to=<previous-sha>
```

This pins the stable replica set to the previous revision and skips analysis. Expect traffic to be fully back on the old revision in about 90 seconds.

## Database changes

Migrations run as a separate pre-deploy job and must be backwards compatible with the currently running revision, because during a rollout both revisions are live. Expand-then-contract across two releases; never combine a column drop with the code change that stops writing it.

## Checks before you merge

- [ ] Change is behind a flag if it is user-visible
- [ ] Migration is backwards compatible with the previous revision
- [ ] You are available for the next 20 minutes

## Related

- [Database failover](./database-failover.md)
- [Incident severity definitions](../../policies/incident-severity.md)
