# Running more than one instance

The question for every long-lived service: what breaks if two copies run behind a load balancer, and what breaks while a deploy runs old and new copies side by side?

## State that must not live in process memory
- **Pub/sub and socket subscriptions.** If a publisher posts to one instance, subscribers connected to the others miss events. Use a shared bus (Redis pub/sub, SNS→SQS per instance, a DB stream), or fan out to every instance through discovery.
- **Sessions, OAuth state, nonces, one-time tokens, pending approvals or waiters, long-poll registrations.** These must live in a shared store, or the follow-up request lands on another instance.
- **Rate limiters that enforce a quota** (per user/tenant/API key). With N instances the limit becomes N×, and it resets on restart. Use a shared counter with a TTL. A local limiter used only for self-protection (load shedding) is fine.
- **Work queues held in arrays or Maps.** They're lost on restart or deploy. Use a durable queue or table with claim semantics.

## Caches
- A process-local cache of immutable data, or of data refreshed per instance on a timer, is fine. For mutable data it needs a TTL, a version check on hit, or cross-instance invalidation. Otherwise revocations, rotations, permission changes and deletes only take effect where they were made.
- For security-relevant caches (keys, permissions, credentials), a TTL only limits how stale the data can get; it doesn't revoke anything. Revocation needs a version check or an invalidation push.
- Unbounded `Map` caches keyed by user/tenant/entity/fingerprint leak memory. Use an LRU with a size bound, and refresh an entry's position on hit (FIFO eviction throws away hot entries).
- Stampedes: on a miss or expiry of a hot key, N callers each load it (KMS, DB, external API). Use single-flight, plus stale-while-revalidate or early expiry for hot keys.
- Caching only positive results means every denial re-runs the expensive check. Cache negatives with a short TTL.

## Background work
- A timer or cron that does *shared* work (writes rows, sends, calls external APIs) runs once per instance. Give it a lease row (job name, owner, expiresAt, taken with a conditional write), or run it on a single worker on purpose and say so. Per-instance housekeeping (cache refresh, metrics flush, local cleanup) and cheap idempotent jobs don't need one.
- **Work claims** need:
  - a conditional claim;
  - an owner unique per operation, not per process (a process can re-take its own lease while its first attempt is still running);
  - a heartbeat that aborts the work when renewal fails;
  - a lease longer than the longest step, or renewed during it;
  - idempotent steps for crash replay;
  - **a fencing token**: a lease version incremented on every claim and checked as a condition on every write the work makes. A GC pause or blocked event loop can outlive any lease, so without fencing the old holder can still write after a new one has taken over.
  
  Compute expiry in the store (store-side time, or a margin), not by comparing clocks across machines.
- Bounded concurrency per tick. A tick that starts every pending item at once falls over on a burst; a serial tick grows O(N), and one slow item blocks the rest.
- Retries stored on the row (`nextAttemptAt`) with exponential backoff and jitter, a max attempt count, and a dead-letter or failed state. Otherwise poison items retry forever.
- Graceful shutdown: on SIGTERM, stop claiming new work, wait (bounded) for in-flight work, then release leases. Otherwise every deploy restarts all in-flight work after the leases expire.

## Process robustness
- Un-awaited native promises without `.catch` crash the process on rejection (Node ≥ 15). Fix each call site. A process-level `unhandledRejection` handler *disables* that crash, so if you add one, make it log **and exit**.
- Long-held HTTP calls between services (builds, exports) die on any deploy, scale-in or load-balancer idle timeout. Start the job, then poll or call back.
- WebSocket servers need slow-consumer handling (check `bufferedAmount`; drop or close past a threshold), ping/pong to detect dead peers, and draining on deploy.
- Clients that reconnect at a fixed backoff without jitter, then replay every subscription or init at once, create a synchronized storm after each server deploy.

## Local-only resources
- Files on local disk, host-bound providers (local VMs, sockets) and in-process SQLite all need host affinity. Document it, or route work to the owning host.
