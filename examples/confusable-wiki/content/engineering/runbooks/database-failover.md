---
title: Database failover runbook
tags: [runbook, postgres, failover, patroni, ops]
owner: data
status: current
updated: 2026-07-02
---

# Database failover runbook

**Current procedure.** Use this when the Postgres primary is unhealthy, unreachable, or must be moved for maintenance. There is no deprecated predecessor for this page.

## Topology

Each region runs one primary and two synchronous-candidate replicas managed by Patroni with etcd as the DCS. Replication is `synchronous_commit = remote_write` with `synchronous_standby_names = ANY 1 (replica_a, replica_b)`, so one replica must acknowledge every write.

Measured objectives: **RTO about 4 minutes**, **RPO under 30 seconds**. The RPO is not zero because the asynchronous cross-region standby can lag.

## Automatic failover

Patroni promotes a healthy candidate when the primary's lease expires (10-second TTL, 5-second loop). In the normal case you will get paged after the promotion has already happened. Your job then is verification, not intervention.

## Manual switchover (planned)

```
orbitctl db switchover --region us-east-1 --candidate replica_a
```

This does a controlled handoff: pauses writes, waits for the candidate to catch up fully, promotes, and repoints the connection pooler. Expect 8 to 12 seconds of write errors, which surface to users as retried 503s.

## Manual failover (primary already gone)

1. Confirm the primary is genuinely unreachable from two vantage points. Split-brain is worse than downtime.
2. Check candidate lag: `orbitctl db lag`. Do not promote a candidate lagging more than 5 MB unless the alternative is prolonged outage — say so explicitly in the incident channel if you do.
3. Promote: `orbitctl db failover --force --candidate <name>`.
4. Repoint the pooler and verify `pg_is_in_recovery()` is false on the new primary.

## After any failover

- [ ] Old primary fenced and not accepting writes
- [ ] Replica count back to two (rebuild with `orbitctl db reinit <node>`)
- [ ] Synchronous standby names updated
- [ ] Connection error rate back to baseline
- [ ] Note the write-error window in the incident timeline

## Do not

Do not `pg_ctl promote` by hand. Patroni will fight you and you can end up with two nodes believing they are primary.
