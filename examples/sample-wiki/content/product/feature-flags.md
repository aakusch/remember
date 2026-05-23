---
title: Feature flags
tags: [product, engineering, flags, launchdarkly]
owner: platform
status: stable
---

# Feature flags

Every customer-facing change ships behind a flag. This page covers what's in scope, how to name flags, and how to retire them.

## When to use a flag

**Always:**

- New features (even small ones)
- Behavior changes to existing features
- Performance experiments
- Anything you'd want to disable without a redeploy

**Sometimes:**

- Refactors where you want to flip between the old and new implementation
- Migrations where you want to A/B compare

**Don't:**

- Bug fixes (just fix them)
- Code style changes
- Internal-only tooling

## Flag types

- **Release flag** — gradual rollout to all users. Lifetime: weeks. Retired after full rollout.
- **Operational flag** — kill switch for ops to disable a feature in an incident. Lifetime: indefinite, intentionally.
- **Experiment flag** — A/B testing two variants. Lifetime: experiment duration + 2 weeks for analysis.
- **Permission flag** — gates features by tenant. Lifetime: indefinite, often by SKU.

## Naming

`<type>.<area>.<feature>`

Examples:

- `release.search.semantic-v2`
- `op.checkout.disable-stripe-3ds`
- `exp.onboarding.skip-tutorial`
- `perm.workspaces.enabled`

## Lifecycle

1. **Create** the flag in LaunchDarkly before the PR opens
2. **Default off** for production until rollout begins
3. **Roll out** gradually: 1% → 10% → 50% → 100% with at least 24 hours between steps
4. **Monitor** the metric that motivated the feature, plus error rate
5. **Clean up** within 30 days of full rollout — delete the flag from LaunchDarkly and remove the code branches

The cleanup step is critical. Flag debt is real; a codebase littered with stale flags is unreadable.

## Anti-patterns

- **Nested flags** — flag A controls behavior X, flag B controls behavior Y within X. Confusing; collapse into a single decision tree.
- **Flags that never get cleaned up** — set a calendar reminder; we audit quarterly
- **Backend-only flags for frontend features** — the frontend should make the same decision, not just receive the result. Otherwise you can't test in isolation.

## Related

- [Roadmap](./roadmap.md)
- [Code style](../engineering/code-style.md)
- [Deploy runbook](../engineering/runbooks/deploy.md)
