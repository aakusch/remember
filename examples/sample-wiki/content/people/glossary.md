---
title: Glossary
tags: [people, glossary, reference]
owner: people-ops
status: living-document
---

# Glossary

Internal terms, acronyms, and shortcuts. If you encounter a term that isn't here, ask in #questions and we'll add it.

## A

- **ADR** — Architecture Decision Record. Markdown doc capturing a load-bearing engineering decision. See [the ADR series](../engineering/adrs/).
- **AOR** — Area of Responsibility. Internal phrasing for "thing a person owns".

## B

- **BB** — Buddy Bot, our Slack helper for onboarding. Don't try to chat with it about anything else.
- **Backstage** — the engineering portal that catalogs services and their owners.

## C

- **Canary** — a partial production rollout (default 10%) used to validate a deploy before going to 100%. See [Deploy runbook](../engineering/runbooks/deploy.md).
- **CW** — Customer Wins. Internal monthly newsletter from sales.

## D

- **Design Partner** — a customer who agrees to be an early-access tester for an unreleased feature, in exchange for direct PM access and influence on the design.
- **DRI** — Directly Responsible Individual. One person, named explicitly, who owns the outcome. Inherited from Apple terminology.

## F

- **Feature flag** — a runtime toggle for code paths. We use LaunchDarkly. See [Feature flags](../product/feature-flags.md).

## I

- **IC** — Incident Commander. The single person coordinating during an incident. See [Incident response](../ops/incident-response.md).
- **IC** — also Individual Contributor. Context disambiguates.

## L

- **LCP** — Largest Contentful Paint. A Web Vitals metric we track for the marketing site and app.

## N

- **NPS** — Net Promoter Score. We run this quarterly. The verbatims are more useful than the score.

## O

- **Op flag** — operational kill switch flag, distinct from release flags. See [Feature flags](../product/feature-flags.md).

## P

- **Page** — being woken up by PagerDuty. Used as a verb: "I got paged twice last night."
- **Postmortem** — written analysis after an incident. Required for SEV1 and SEV2.

## R

- **Runbook** — step-by-step doc for an ops procedure. Lives under `engineering/runbooks/`.

## S

- **SEV** — severity. SEV1 is the worst.
- **SLO** — Service Level Objective. Our internal commitment to availability and latency.
- **SSO** — Single Sign-On.

## T

- **Toggle** — same as a flag. We try to be consistent on "flag" but the slang shows up.

## Related

- [Handbook](./handbook.md)
- [Onboarding](./onboarding.md)
