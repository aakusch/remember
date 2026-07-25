---
title: "Secret rotation runbook (legacy self-hosted Vault)"
tags: [runbook, secrets, vault, security, engineering]
owner: security
status: deprecated
superseded_by: engineering/runbooks/secret-rotation.md
retired: 2026-04-15
---

# Secret rotation runbook (legacy self-hosted Vault)

**Deprecated — do not use.** The self-hosted Vault cluster was drained and shut down on 2026-04-15. The live procedure is the [secret rotation runbook](./secret-rotation.md). This page stays because SOC 2 evidence for 2024 and 2025 rotations refers to the ticket and script names below, and because the 90-day cadence quoted here is still repeated in old onboarding decks.

## Cadence (historical)

Secrets were rotated **every 90 days**, manually, driven by a recurring ticket assigned to the security on-call. Missing the window produced an audit exception that had to be written up.

## Scope (historical)

Database passwords, third-party API keys, the JWT signing key, and the internal mTLS CA all lived in the Vault KV v2 mount at `secret/orbit/<env>/<name>`.

## Procedure (historical)

1. Claim the rotation ticket and announce in `#security-ops`.
2. Unseal a quorum with three of the five key shares if the cluster had restarted.
3. Run `./scripts/vault-rotate.sh --path secret/orbit/prod/<name> --generate`, which wrote the new value as a new version.
4. Trigger a rolling restart of every consuming service so it re-read the value at boot. Services did **not** hot-reload secrets.
5. Verify the old version was no longer referenced, then run `vault kv destroy` on versions older than three.
6. Attach the command output to the ticket as audit evidence.

Because step 4 required a restart of every consumer, rotations were effectively small planned outages and were scheduled in the old deploy windows.

## Known problems

Manual quorum unsealing meant rotation could not happen without three specific people, the JWT signing-key rotation invalidated every session in flight, and two rotations in 2025 were skipped entirely and written up as exceptions. All three problems are addressed by the current runbook.
