---
title: Staging API configuration
tags: [config, staging, api, reference]
owner: platform
status: current
environment: staging
updated: 2026-07-14
---

# Staging API configuration

**Reference for the staging environment only.** This page is deliberately shaped like the [production API configuration](./production-api-config.md) so the two can be compared side by side — which also makes them easy to confuse. Nothing here describes production behaviour.

## Endpoints

- Public: `api.staging.orbit.example.com`
- Internal: `api.staging.internal`
- Regions: `us-east-1` only. There is no staging footprint in `eu-west-1`, so anything region-specific cannot be validated here.

## Capacity

- Fixed 2 replicas, no autoscaling
- Pod limits: 1 vCPU, 2 GiB
- Load tests above roughly 300 requests per second will saturate the cluster and produce misleading results

## Rate limits

- **1,000 requests per minute per tenant** — deliberately relaxed so integration suites do not trip it
- No per-IP limit on auth routes
- Because the limit is relaxed, **429 handling cannot be tested here**; use a local run with the production limit instead

## TLS and transport

- **TLS 1.2 and TLS 1.3 both accepted**, because two partner sandboxes still negotiate 1.2
- No HSTS
- mTLS optional between internal services, which regularly hides certificate misconfiguration until production

## Logging and observability

- Application log level **DEBUG** by default
- Request logs retained **3 days**
- Traces sampled at 100%

## Data and providers

The database is reseeded from an anonymised fixture set every night at 03:00 UTC, so anything you write here disappears. Payment and email providers point at **sandbox** accounts with fake keys; email is captured by a mailbox trap and never delivered. Two permanent test tenants exist: `acme-test` and `globex-test`.
