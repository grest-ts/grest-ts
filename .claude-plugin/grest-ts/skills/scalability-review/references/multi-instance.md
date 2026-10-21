# Running more than one instance

The question for every long-lived service is: what breaks if two copies run behind a load balancer, and what breaks while a deploy has old and new copies running together?

## State that must not live in process memory
- **Pub/sub and socket subscriptions.** If a publisher posts to one instance's URL, subscribers connected to other instances miss events. Fix with a shared bus (Redis pub/sub, SNS→SQS per instance, a DB stream), or by fanning out to every instance through service discovery.
- **Sessions, OAuth state, nonces, one-time tokens, pending approvals or waiters, long-poll registrations.** These must be in a shared store, or the follow-up request lands on another instance and fails.
- **Rate limiters, quotas and dedupe sets.** With N instances the effective limit becomes N× the configured one, and a restart resets it. Use a shared counter with a TTL.
- **Queues of work held in arrays or Maps.** These are lost on restart or deploy. Use a durable queue or table with claim semantics.

## Caches
- A process-local cache is fine for immutable data. For mutable data it needs a TTL, a version check on hit, or cross-instance invalidation. Otherwise revocations, credential rotations, permission changes and deletes only take effect on the instance that handled the write.
- Security-relevant caches (keys, permissions, credentials) are the worst case: a "delete" or "revoke" that only clears the local cache isn't really a revoke.
- Unbounded `Map` caches keyed by user, tenant, entity or cert fingerprint leak memory. Use an LRU with a size bound, and refresh the entry's position on hit (FIFO eviction throws away hot entries).
- Avoid a cold-start stampede: on a miss, N concurrent callers should share one in-flight load (single-flight) rather than each fetching (KMS decrypt, DB read, external API).
- Caching only positive results means each denial triggers the expensive check again.

## Background work
- Every `setInterval`, cron or poller runs once per instance. Give each job a lease row (job name, owner, expiresAt) taken with a conditional write, or explicitly run the job on a single worker and say so in the code and docs.
- Work claims need: a conditional claim; an owner unique per operation (not per process, or the same process can re-take its own lease while the first attempt is still running); a heartbeat that aborts the work when it can't renew; a lease longer than the longest step, or renewed during it; and idempotent steps for crash replay.
- Bounded concurrency per tick. A tick that starts every pending item at once falls over on a burst; a serial tick grows O(N) and one slow item blocks the rest.
- Graceful shutdown: on SIGTERM, stop claiming, wait (bounded) for in-flight work, then release leases. Otherwise every deploy restarts all in-flight work from scratch after lease expiry.
- Retry with backoff stored on the row (`nextAttemptAt`), not "pick it up again next tick".

## Process robustness
- `void promise` or a fire-and-forget call with no `.catch`. On Node ≥ 15 an unhandled rejection kills the process by default, so one downstream outage becomes a crash loop. Add `.catch(log)`, plus a process-level `unhandledRejection` logger.
- Long-held HTTP calls between services (builds, exports) die on any deploy, scale-in or load-balancer idle timeout. Start the job, then poll or call back.
- WebSocket servers with no slow-consumer handling: check `bufferedAmount` and drop or close past a threshold.
- Clients that reconnect at a fixed backoff without jitter, then replay every subscription and init at once. After a server deploy this becomes a synchronized storm.

## Local-only resources
- Files on local disk, host-bound providers (local VMs, sockets) and in-process SQLite all need host affinity. Document them, or route work to the owning host.
