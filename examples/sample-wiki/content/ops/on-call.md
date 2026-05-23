---
title: On-call
tags: [ops, on-call, oncall, incident]
owner: ops
status: stable
schedule: PagerDuty rotation "platform-prod"
---

# On-call

This page covers everything you need to know to take an on-call shift.

## Schedule

We rotate weekly, Monday 09:00 ET → following Monday 09:00 ET. Primary + secondary, both paged simultaneously for SEV1; only primary for SEV2/3.

Schedule lives in PagerDuty under "platform-prod". You can swap shifts via PagerDuty directly — no manager approval needed for same-week swaps.

## Before your shift

48 hours before:

- [ ] Test that PagerDuty pages your phone (request a test page from PagerDuty UI)
- [ ] Make sure you have VPN access working
- [ ] Confirm bastion SSH key is in your agent
- [ ] Review the [Incident response](./incident-response.md) playbook
- [ ] Skim recent #incidents posts to know what's been hot lately

## During your shift

Response time targets:

- **SEV1**: 5 minutes to acknowledge, 15 minutes to first communication
- **SEV2**: 15 minutes to acknowledge, 1 hour to first communication
- **SEV3**: next business day acknowledge

When paged:

1. Acknowledge in PagerDuty within target
2. Read the alert and the linked dashboard
3. Decide severity (don't be heroic — escalate if you're not sure)
4. Open the incident channel via `/incident open`
5. Follow [Incident response](./incident-response.md)

## What you don't have to do

You are **not** expected to fix every problem yourself. Page the relevant team if:

- The issue is in a service you don't own
- You've been head-down for 30 minutes without progress
- The blast radius is widening

Pages cost much less than extended outages.

## After your shift

By the following Wednesday:

- [ ] Update the on-call handoff doc with anything notable
- [ ] File follow-up tickets for any debt you accrued during the shift
- [ ] If anything paged spuriously, file a ticket to fix the alert

## Compensation

On-call shifts are compensated per the company handbook. Page volume above threshold is also compensated as overtime — see [Handbook §6.4](../people/handbook.md).

## Related

- [Incident response](./incident-response.md)
- [Monitoring & alerts](./monitoring.md)
- [Rollback runbook](../engineering/runbooks/rollback.md)
