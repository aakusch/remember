---
title: Confusable Wiki
tags: [index, meta]
owner: platform
status: current
updated: 2026-07-20
---

# Confusable Wiki

This is the internal engineering wiki for the Orbit platform team. It is deliberately messy in one specific way: we keep old pages instead of deleting them, because incident timelines and audit requests routinely need the version of a policy that was in force at the time.

That means several pages in here look like the answer but are not. Read the status field before you act on a page.

## Status conventions

Every page carries a `status` field in its frontmatter and repeats the same claim in the first paragraph of prose:

- **current** — authoritative. This is what we do today.
- **superseded** — replaced by a named successor. Kept for history. Never cite it as the present state.
- **deprecated** — the described tooling still exists but must not be used for new work.
- **archived** — a policy that was in force during a past period. Useful for audits, wrong for today.
- **draft** — proposed, never approved. Not binding on anyone.

If two pages disagree, the one marked `current` wins, and the other one should name its successor. If neither names a successor, that is a bug in the wiki — file it in `#platform-docs`.

## Layout

- `engineering/adrs/` — architecture decision records, including rejected and superseded ones
- `engineering/runbooks/` — operational procedures
- `config/` — per-environment configuration references
- `policies/` — retention, severity, and process policies, plus `policies/archive/` and `policies/drafts/`
- `services/` — one page per deployed service, including services being decommissioned

## Conventions we do not repeat on every page

Pages assume you already know: services deploy from `main`, all environments run in `us-east-1` and `eu-west-1`, and every page has a named owner who is accountable for its status field being honest.
