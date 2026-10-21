---
name: scalability-review
description: Find code that breaks with more users, more history, or more than one instance — unbounded queries filtered in code, N+1, in-memory state, races, unsafe retries, quotas. Use for "will this scale", when finishing a feature (diff mode), or for a full-repo audit. Knows grest-ts failure modes.
---

# Scalability review

Find code that works today and breaks at N: more users, bigger orgs/tenants, more history, more traffic, or more than one instance of a service. Report only what will actually break or degrade, with a concrete scale and a concrete fix — not style.

## Modes

The mode comes from the invocation arguments (`$ARGUMENTS`: `diff`, `audit`, optionally a path) or the user's request. Default is **diff**.

- **diff** — review what this branch changed: files from `git diff --name-only $(git merge-base HEAD <base>)...HEAD` plus uncommitted/staged changes, base = whichever of `origin/HEAD`, `dev`, `develop`, `main`, `master` exists and has the fewest commits in `<base>..HEAD` (the default branch isn't always the integration branch). Skip tests, docs and pure UI copy/styling. Follow a hunk one hop into the code it calls only when it touches data access, loops, endpoints, jobs or external calls (a new list endpoint is only as good as the store method behind it); follow callers only for new or changed shared helpers (harmless once, a problem per row or per request). Report what the change introduces or puts on a hotter path; pre-existing problems found on the way go under "Nearby, pre-existing". Do it yourself, no sub-agents.
- **audit** — whole repo (or the given path). Survey the layout, then fan out parallel read-only review agents, one per area (data layer, background jobs/workers, request-serving tier + sockets, feature modules, UI, infra-as-code). Give each this file's checklist, only the references for its area, and the finding format. Merge, dedupe by `file:line`, then spot-check every critical finding yourself before reporting.

## Before you start

Load the references that match — only those:

| Signal | Load |
|---|---|
| Changed code uses `@grest-ts/*` packages | `references/grest-ts.md` — only the sections for the packages it uses |
| DynamoDB (`@aws-sdk/client-dynamodb`, `@grest-ts/db-dynamodb`, `aws_dynamodb_table`, `CreateTable` inputs in code) | `references/dynamodb.md` |
| Long-running services, workers, crons, websockets, caches, retries | `references/multi-instance.md` |
| IaC files changed (Terraform/CDK/CloudFormation/Beanstalk/k8s/compose), or audit mode | `references/infra.md` |

For a "more than one instance" finding in diff mode, grep the IaC for that service's instance count instead of loading `infra.md`: it decides whether the problem is live or latent.

## Checklist

**Before reporting anything, name what bounds it**: a `limit` on the fetch, a cap enforced in code, a static/seed table, a single-process tool by design. If you can name a real bound, don't report. Filtering inside one bounded page is fine. A `limit` whose cursor is ignored is truncation, not a bound.

**Data access**
- Full scan / whole-partition query, then `.filter/.find/.some/.sort/.slice` in code → cost O(all rows), grows forever.
- Query with no limit/cursor on a collection that grows → huge responses, memory spikes, or hard library caps.
- Access pattern with no matching index ("list X by Y" done by loading all X); "get one" done as "list all and find".
- N+1: `await` per item in a loop — DB gets or service-to-service calls; use batch reads / bulk endpoints.
- Aggregates (usage, cost, counts, "latest") computed by loading rows on request instead of rollups / sorted index + limit 1.
- Pagination done after fetching everything; offset paging on large or changing sets (O(offset), skips/duplicates) — use keyset/cursor.

**Data lifecycle**
- Soft-deleted or historical rows in the same index the hot path reads.
- History/log/event/session tables with no TTL or retention.
- Records that accumulate lists/maps forever.
- Hot keys: one constant or low-cardinality key absorbing most reads/writes.

**Concurrency and correctness**
- Read-modify-write without a condition/version → lost updates (more likely with more writers/instances).
- Uniqueness via "check then insert" against an eventually consistent index → duplicates.
- Short random IDs (8 hex = 32 bits: ~1% collision at ~9k rows, ~50% at ~77k) on rows kept forever; inserts that overwrite on collision.
- Leases/locks without a fencing token, or owned by the process instead of the operation (see `multi-instance.md`).
- Timeouts (`Promise.race`, deadline helpers) that stop waiting but don't cancel the work → zombie operations.
- DB write + publish/enqueue that aren't atomic (lost or phantom events — use an outbox); at-least-once consumers without dedupe by message id.
- Un-awaited native promise without `.catch` → crashes the process (Node ≥ 15).

**More than one instance** (details: `references/multi-instance.md`)
- In-memory pub/sub, sessions, waiters, work queues, quota-enforcing rate limiters, dedupe sets.
- Process-local caches of mutable data with no TTL/version and no cross-instance invalidation (revocations, rotations, deletes don't propagate).
- Timers/crons with no lease that do *shared* work (write rows, send, call external APIs).
- Unbounded `Map`/`Set` caches keyed by user/tenant/entity.

**Retries, timeouts, external APIs**
- Outbound calls with no timeout, or no deadline passed down (`AbortSignal`).
- Retries without jitter, a max-attempts / dead-letter state, or at more than one layer (3 layers × 3 tries = 27×); retried non-idempotent writes without an idempotency key.
- Third-party calls (GitHub, cloud provider, KMS/STS, LLM APIs) on the request path without cache; full pagination of user-scoped lists per request.
- No 429/`Retry-After` handling; rate-limit 403s read as "no access"; one credential/quota shared by all tenants; polling without backoff.

**Request path, fan-out, overload**
- Long work inside an HTTP request (bulk copy, builds, mass delete/re-sync) → killed by LB timeouts and deploys, retried in full.
- Unbounded `Promise.all` over a user's/tenant's entities; serial loops whose duration grows O(N) in a request or cron tick.
- Unbounded in-memory queues / no load shedding; one slow downstream able to exhaust shared workers or connections (no bulkhead).
- Large payloads buffered in memory instead of streamed / stored in object storage with presigned URLs.

**UI / clients**
- Fetch-all then filter/search/paginate in the browser; unvirtualized lists of unbounded size.
- Polling or heartbeats that fan out per item × per tab; reconnect without jitter; replaying every subscription on reconnect.
- One socket/subscription per row; broadcast responses meant for one requester.

**Infra** (details: `references/infra.md`)
- Max instances = 1, single AZ/location/subnet/NAT, burstable instances on hot paths, all-at-once deploys without drain, hard platform caps.

## Calibrating severity

Severity = impact × likelihood at a scale the product will plausibly reach.

- **critical** — fails outright (errors, data loss or corruption of money/permissions/ownership, cross-tenant leak); or blocks a second instance of a service that needs one.
- **high** — cost/latency grows with history or tenant size on a hot path (per request, page load, tick); quota exhaustion; lost updates on ordinary data.
- **medium** — same pattern on a cold path, or bounded but large.
- **low** — theoretical or far away; races whose worst case is a soft cap exceeded by one.

Hard caps turn "slow" into "fails": an unbounded read that throws past a limit (grest-ts `query()` at 10k rows) is **critical** if the collection plausibly reaches it within about a year at its write rate (rows per user/day × users × days), otherwise **high**.

Weigh the caller: the same scan is critical behind a page polled every 5 s and low behind a monthly admin export — unless a hard cap makes it fail outright.

Known, accepted limits (a code comment or IaC saying "single instance until X"): report once, name the guard, mark `known`; in diff mode re-raise only if the change makes it worse.

Don't flag: single-process CLIs/scripts, test code, local-dev adapters, style, micro-optimizations.

## Finding format

```
### <SEVERITY> — <one-line title>
`path/to/file.ts:42` (+ related `file:line`s)
- Breaks: <what fails, roughly at what scale>
- Caller: <who triggers it, how often>
- Fix: <concrete change: index/key, API to use, where the work should move>
- Confidence: confirmed | plausible | known
```

Most severe first. In diff mode, give medium and above in full and lows as one line each (`LOW — title — file:line`); if nothing survives: "No scalability issues in <N> changed file(s)." In audit mode, finish with the 3–5 root causes that explain most findings and a suggested fix order.
