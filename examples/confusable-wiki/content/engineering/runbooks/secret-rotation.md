---
title: Secret rotation runbook
tags: [runbook, secrets, security, engineering]
owner: security
status: current
updated: 2026-05-12
---

# Secret rotation runbook

**Current procedure.** Replaces the deprecated [legacy self-hosted Vault runbook](./secret-rotation-legacy-vault.md), retired 2026-04-15. If you are following a 90-day manual cadence with `vault-rotate.sh`, you are on the wrong page.

## Cadence

Rotation is **automatic every 30 days** for every managed secret, driven by AWS Secrets Manager rotation schedules. Nobody claims a ticket and nobody clicks anything in the normal case. The security on-call reviews a weekly digest of rotation outcomes instead.

## How it works

Each secret has a rotation Lambda implementing the four-step contract:

1. `createSecret` — generate the new value into the `AWSPENDING` stage.
2. `setSecret` — apply it at the provider. For Postgres this uses the paired-user pattern: `orbit_app_a` and `orbit_app_b` alternate, so there is always one working credential.
3. `testSecret` — connect with `AWSPENDING` and run a real query.
4. `finishSecret` — promote `AWSPENDING` to `AWSCURRENT`.

Services **hot-reload** secrets. The config client re-reads `AWSCURRENT` every 60 seconds and swaps the connection pool credential on the next checkout. No restart, no deploy, no maintenance window.

## Signing keys

The token signing key is different: it rotates every 30 days but both the previous and current keys stay published in the JWKS document for 24 hours, so tokens issued before the swap keep verifying. Never delete a key from JWKS on the same day you rotate it.

## Break-glass rotation

For a suspected compromise, rotate immediately and skip the grace period:

```
aws secretsmanager rotate-secret --secret-id orbit/prod/<name> --rotate-immediately
```

Then, for the signing key only, run `orbitctl jwks prune --force`, which drops the old key from JWKS at once and signs everyone out. This is the only rotation that is user-visible; declare an incident before you run it.

## Verification

- [ ] Rotation digest shows `finishSecret` success for the secret
- [ ] Connection error rate flat across the swap window
- [ ] For signing keys, JWKS lists exactly two keys
