---
title: Incident response
tags: [ops, incident, oncall, playbook]
owner: ops
status: stable
severity: critical
---

# Incident response

Use this when something is broken in production. Follow the steps in order — the order matters more than perfect adherence to each step.

## Severity definitions

- **SEV1** — full or partial outage. Users can't do core flows (login, primary action, payment). Page on-call immediately, all hands welcome.
- **SEV2** — degraded experience. A feature is broken or slow, but workarounds exist. Page primary, secondary optional.
- **SEV3** — minor issue. Can wait until business hours.

If you're unsure between SEV1 and SEV2, choose SEV1. Over-triaging is fine.

## Step-by-step

### 1. Acknowledge and assess

Read the alert. Open the linked dashboard. Form a hypothesis about what's broken and what's blast radius.

If you can't form a hypothesis in 5 minutes, that's fine — escalate to a wider audience.

### 2. Open an incident channel

```
/incident open severity=sev1 "checkout flow returning 500s"
```

This creates `#inc-NNN`, sets up a Zoom bridge, pings the on-call group, and starts a status page note.

### 3. Assign roles

Even at SEV2 with two people, name roles explicitly:

- **Incident commander (IC)** — coordinates, makes decisions, communicates externally
- **Operator** — hands on keyboard, executes changes
- **Scribe** — keeps the timeline updated in the incident channel

These can rotate, but at any moment one person owns each role.

### 4. Mitigate first, fix later

Your goal is to stop the bleeding, not to fully resolve the issue:

- Can you rollback? → [Rollback runbook](../engineering/runbooks/rollback.md)
- Can you flip a feature flag to disable the broken feature?
- Can you scale up if it's a capacity issue?
- Can you fail over to a replica if a single instance is bad?

Mitigation buys you time to investigate properly.

### 5. Communicate

Updates every 15 minutes minimum during SEV1, even if "still investigating". Silence makes everyone anxious.

Channels:

- **#inc-NNN** — detailed technical updates for responders
- **Status page** — short, customer-facing message
- **#general** — company-wide update if customer-impacting

### 6. Resolve

The incident is resolved when:

- The user-facing symptom is gone
- A monitoring window confirms it hasn't recurred (15 minutes for SEV1)
- The IC declares it resolved in #inc-NNN and on the status page

### 7. Postmortem

Within 5 business days. Required for every SEV1 and SEV2. Template at `incidents/template.md`.

## Anti-patterns

- **Heroics**: one person grinding for hours without escalating
- **Speculation as fact**: "I think it's the database" → "the database CPU is at 95%, here's the screenshot"
- **Silent investigation**: 30 minutes of typing in #inc-NNN with no updates to #general
- **Premature resolution**: declaring victory before the monitoring window passes

## Related

- [On-call](./on-call.md)
- [Monitoring & alerts](./monitoring.md)
- [Rollback runbook](../engineering/runbooks/rollback.md)
