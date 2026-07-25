---
title: "Deploy runbook (v1 — Jenkins)"
tags: [runbook, deploy, jenkins, release, engineering]
owner: platform
status: deprecated
superseded_by: engineering/runbooks/deploy.md
retired: 2026-02-28
---

# Deploy runbook (v1 — Jenkins)

**Deprecated — do not use.** The Jenkins controller described here was decommissioned on 2026-02-28. The current procedure is the [deploy runbook](./deploy.md). This page exists because audit evidence for releases before March 2026 points at these job names, and because the freeze-calendar rules below are still quoted at people by mistake.

## Release windows (historical)

Deploys were allowed **only on Tuesdays and Thursdays at 14:00 UTC**, outside of the quarter-end freeze. Anything else needed an exception ticket signed by the release manager on duty.

## Approval (historical)

Every production deploy required a manual gate click by the **release manager**, who was a named rotating role, not the author. Authors could not deploy their own changes, and a second engineer had to be present in `#releases` for the window.

## Procedure (historical)

1. Merge to `main` and wait for the `orbit-build` job to publish an artifact.
2. Open the `orbit-deploy-prod` job, enter the artifact tag, submit.
3. Wait at the "Approve production" gate for the release manager.
4. Watch the `orbit-smoke` job. Any failure aborted the deploy automatically.
5. Announce completion in `#releases` with the tag and the Jenkins build number.

Deploys replaced all instances in a rolling batch of 25% and took 18 to 25 minutes end to end.

## Rollback (historical)

Run the `orbit-rollback` job with the previous artifact tag. It re-deployed the prior artifact through the same rolling batches, so recovery was also 18 to 25 minutes — the main reason this pipeline was replaced.

## What to do instead

Nothing on this page should be followed. Use the current runbook, which deploys continuously on merge, uses progressive canary analysis, and does not have release windows or a release-manager gate.
