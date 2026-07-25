---
title: "Incident severity matrix (draft)"
tags: [policy, incident, severity, draft, ops]
owner: unassigned
status: draft
drafted: 2025-11-03
approved: false
---

# Incident severity matrix (draft)

**Draft — never approved, do not cite.** This proposal was written in November 2025 to move the team from SEV numbering to P-numbering. It was discussed twice, never adopted, and the author has since left. The binding definitions are in the [incident severity definitions](../incident-severity.md), which use SEV1–SEV4 and different response timings. This page survives only because several older postmortems reference "P0" and readers need somewhere to decode that.

## Proposed levels

- **P0 — any customer-visible error.** Includes a single tenant, and includes elevated error rates that have not yet broken a flow.
- **P1 — internal-only breakage** with a plausible path to customer impact.
- **P2 — degraded non-core feature.**
- **P3 — hygiene and noise.**

Note the mismatch that causes most of the confusion: in this draft, **a single-tenant outage is P0 (the top level)**, whereas the approved policy classifies single-tenant impact as SEV2.

## Proposed timings

| Level | Acknowledge | Update cadence |
| --- | --- | --- |
| P0 | **2 minutes** | every **10 minutes** |
| P1 | 10 minutes | every 30 minutes |
| P2 | 4 hours | daily |
| P3 | none | none |

## Why it was not adopted

Two objections stopped it. A 2-minute acknowledge target across a two-person rotation was judged unachievable and would have produced a permanently failing metric. And collapsing "any customer-visible error" into the top level meant roughly nine P0s per week, which trains people to ignore the top level entirely.

## If you are decoding an old postmortem

Postmortems dated before 2026-04-08 sometimes use P-numbering informally. Read P0 as "the author thought this was serious"; there is no reliable mapping to the approved severities, because this matrix was never in force.
