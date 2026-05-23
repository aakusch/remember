---
title: Rollback runbook
tags: [runbook, rollback, ops, incident]
owner: platform
severity: high
status: tested
---

# Rollback runbook

Use this when a deploy needs to be reverted in production. Speed matters more than perfection — you can always investigate after the rollback is complete.

## Decision: rollback or fix-forward?

**Rollback if:**
- Error rate spiked > 5x baseline
- A critical user flow is broken (login, checkout, signup)
- Data is being written incorrectly
- You can't confidently say what's wrong but something is wrong

**Fix-forward if:**
- The issue is contained to a non-critical feature
- A targeted PR can land within 15 minutes
- Rolling back would lose a migration that's hard to reverse

When in doubt, **rollback**. You can always re-deploy after fixing.

## Procedure

### 1. Open the incident

```
/incident open severity=high "rollback in progress"
```

This pings the on-call group and creates a #inc-NNN channel for coordination.

### 2. Trigger the rollback

Two paths:

**Fast path (preferred):** in the GitHub Actions deploy pipeline, click "Rollback to previous". This switches the load balancer to the previous version's pool over 60 seconds.

**Slow path (if Actions is unavailable):** SSH to the bastion, run `./scripts/rollback.sh <previous-tag>`. This does the same thing manually.

### 3. Verify the rollback

After 60 seconds:

- [ ] Error rate is back to baseline (Grafana panel)
- [ ] P99 latency is back to baseline
- [ ] User reports stop coming in to #support

### 4. Communicate

Post in #releases and #incidents:

> Rolled back to v$PREV_TAG due to $REASON. Investigating. Updates in #inc-NNN.

If the rollback affected user-facing functionality for more than 5 minutes, the support team needs to know to handle inbound tickets.

### 5. Investigate

In the #inc-NNN channel:

- What was the symptom?
- What deploy caused it?
- Is the bad code still on `main`? (It usually is.)
- Do we need to revert the merge commit, or can we land a fix-forward PR?

### 6. Don't redeploy the same code

The pipeline blocks you from redeploying the rolled-back tag automatically. If you need to deploy a different fix, that's a new release tag.

## Postmortem

Required for every rollback. Template at `incidents/template.md`. Schedule the review within 5 business days.

## Related

- [Deploy runbook](./deploy.md)
- [Incident response](../../ops/incident-response.md)
- [On-call](../../ops/on-call.md)
