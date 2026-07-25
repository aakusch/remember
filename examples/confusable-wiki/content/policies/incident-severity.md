---
title: Incident severity definitions
tags: [policy, incident, severity, oncall, ops]
owner: ops
status: current
approved: 2026-04-08
approved_by: ops-leadership
---

# Incident severity definitions

**Authoritative and approved (2026-04-08).** These are the severity definitions the paging system, the status page automation, and the postmortem policy are all wired to. An unapproved [severity matrix draft](./drafts/incident-severity-matrix.md) exists that uses P0–P3 naming and different timings; it is not binding and was never adopted.

## Levels

- **SEV1 — platform outage.** A core flow is unavailable or wrong for a large share of tenants: sign-in, the primary API surface, or billing writes. Pages primary and secondary on-call simultaneously.
- **SEV2 — major degradation.** A core flow is degraded, or one flow is fully broken for a single large tenant. Workarounds may exist. Pages primary only.
- **SEV3 — minor issue.** Non-core functionality broken, or a cosmetic problem on a core flow. Ticketed, handled in business hours, no page.
- **SEV4 — no user impact.** Internal tooling, noisy alerts, hygiene. Backlog item.

Single-tenant impact is **SEV2, not SEV1**, unless that tenant is contractually flagged tier-one, in which case the account team can request escalation.

## Response timings

| Severity | Acknowledge | Update cadence | Postmortem |
| --- | --- | --- | --- |
| SEV1 | **5 minutes** | every **20 minutes** | required, within 5 business days |
| SEV2 | **15 minutes** | every 60 minutes | required, within 10 business days |
| SEV3 | next business day | on resolution | optional |
| SEV4 | none | none | none |

## Who declares

The first responder declares an initial severity within the acknowledge window. Only the incident commander may lower a severity, and lowering it must be stated in the incident channel with a reason. Anyone may raise a severity at any time without justification — over-triage is explicitly cheaper than under-triage.

## Mitigation ordering

Stop the bleeding before diagnosing. The two mitigations that cover most cases are the manual rollback in the [deploy runbook](../engineering/runbooks/deploy.md) and disabling the feature flag for the offending change.

## Status page

SEV1 posts a public status page entry automatically at declaration. SEV2 posts only if impact exceeds 30 minutes. SEV3 and SEV4 never post.
