---
title: Production API configuration
tags: [config, production, api, reference]
owner: platform
status: current
environment: production
updated: 2026-07-14
---

# Production API configuration

**Authoritative reference for the production environment.** The near-identical [staging API configuration](./staging-api-config.md) page exists for the staging cluster; every number below differs there. If you are copying a value out of a config page into a production change, confirm you are on this page.

## Endpoints

- Public: `api.orbit.example.com`
- Internal: `api.prod.internal`
- Regions: `us-east-1` (primary), `eu-west-1` (active)

## Capacity

- Minimum 12 replicas per region, maximum 60
- Autoscale on p95 request latency and queue depth, not CPU
- Pod limits: 2 vCPU, 4 GiB

## Rate limits

- **120 requests per minute per tenant** on authenticated routes
- 20 requests per minute per IP on unauthenticated auth routes
- Burst allowance of 30, token-bucket, enforced at the edge
- Exceeding the limit returns `429` with `Retry-After`; there is no soft-fail mode

## TLS and transport

- **TLS 1.3 only.** TLS 1.2 was disabled on 2026-01-31 and cannot be re-enabled without a security exception.
- HSTS with a two-year max-age and preload
- mTLS required for internal service-to-service calls

## Logging and observability

- Application log level **INFO**. Debug logging in production requires a time-boxed flag (`log.debug.tenant=<id>`, maximum 30 minutes).
- Request logs retained **30 days**, per the [data retention policy](../policies/data-retention.md)
- Traces sampled at 5%, with 100% sampling for requests that return 5xx

## Secrets and providers

All credentials come from AWS Secrets Manager and rotate on the 30-day schedule in the [secret rotation runbook](../engineering/runbooks/secret-rotation.md). Payment and email providers point at **live** accounts. There are no seeded fixtures and no test tenants in this environment.
