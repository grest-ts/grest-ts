---
name: scalability-review
description: Find code that breaks with more users, more history, or more than one instance — unbounded queries filtered in code, N+1, in-memory state, races, unsafe retries, quotas — calibrated to what kind of system it is. Use for "will this scale", when finishing a feature (diff mode), or for a full-repo audit. Knows grest-ts failure modes.
---

# Scalability review

Find code that works today and breaks at N: more users, bigger tenants, more history, more traffic, or more than one instance of a service. Judge it against what the system is meant to be. An internal tool on one instance doesn't need multi-region design, but every system should know which simpler choices cap it, and when those choices will hurt. Report only what will actually break or degrade, with a concrete scale and a concrete fix. Don't report style.

**Be strict on data, relaxed on code.** Keys, IDs, persisted names and list contracts are expensive to change once data and clients exist, so a small system gets no discount for them. Caches, in-memory state and loops can be fixed when they start to hurt, so those follow the profile.

## Modes

The mode comes from the invocation arguments (`$ARGUMENTS`: `diff`, `audit`, optionally a path) or the user's request. Default is **diff**.

- **diff** — review what this branch changed: files from `git diff --name-only $(git merge-base HEAD <base>)...HEAD` plus uncommitted/staged changes. Base = the PR's target branch if there is one (`gh pr view --json baseRefName`). Otherwise, of `origin/HEAD` and the local or `origin/` `dev`/`develop`/`main`/`master` refs that exist, the one with the fewest — but more than zero — commits in `<base>..HEAD` (the default branch isn't always the integration branch).
  - Skip tests, docs and pure UI copy/styling.
  - Follow a hunk one hop into the code it calls only when it touches data access, loops, endpoints, jobs or external calls (a new list endpoint is only as good as the store method behind it).
  - Follow callers only for new or changed shared helpers (harmless once, a problem per row or per request).
  - A change that adds or alters a table, key, index, persisted field or list endpoint gets the **Data shape** checks in full, whatever else it touches.
  - Report what the change introduces or puts on a hotter path. Pre-existing problems found on the way go under "Nearby, pre-existing".
  - Do it yourself, no sub-agents.
- **audit** — whole repo (or the given path). Profile the system (below), then fan out parallel read-only review agents, one per area: data layer, background jobs/workers, request-serving tier + sockets, feature modules + external APIs, in-host agents/daemons if any, UI, infra-as-code. A repo small enough to read in one pass you review yourself.
  - Give each agent the system profile, this file's checklist, only the references for its area, and the finding format.
  - Assign each cross-cutting topic to one owning area so it isn't reported five times: shared quotas/external APIs → feature modules; IDs, TTLs, indexes → data layer; instance counts, proxies, LB → infra. Other areas may cite it as a caller.
  - Merge, dedupe by `file:line`, then spot-check every critical finding yourself before reporting.

## Step 0 — System profile

Severity depends on what the system is. Establish it before reviewing:

- **Kind**: internal tool, single-tenant app, multi-tenant SaaS, or a platform operating a fleet (VMs, devices, agents).
- **Expected scale** within about a year, and the **growth unit** that drives data volume. That's often not users: tasks, runs, VMs or events per user per day.
- **Tenancy**: what tenants share — credentials, quotas, accounts, buckets, keys.
- **Instance model per service**: how many instances run, and whether that number is a deliberate choice or an accident.
- **Data**: which tables/collections grow (and with what) and which are bounded (and by what).
- **Accepted limits**: simplifications chosen on purpose, and when to revisit them.

Where to get it:
1. Look for a **"Scale profile"** section in `CLAUDE.md`, `AGENTS.md` or the docs. If one exists, use it and don't re-derive it. If it lacks the growth unit or the Data list, infer those and suggest the missing lines at the end of the report.
2. Otherwise infer it from code and IaC: instance counts, tenancy keys, shared credentials, comments like "single instance until…". Then read the project docs only to separate deliberate from accidental.
3. If kind or expected scale is still unclear, **ask the user** one short question rather than guessing. For example: "Internal tool for ~50 users on one instance, or multi-tenant SaaS expected to grow?" When you can't ask, state the assumption at the top of the report.
4. When the profile was missing, end the report by recommending a "Scale profile" section in `CLAUDE.md`/`AGENTS.md`, filled in from what you learned. The template is in `references/scale-profile.md`.

In diff mode, keep this to a sentence or two. Ask only if the answer would move a finding by at least one severity level, or between finding and debt.

## Before you start

Load the references that match — only those:

| Signal | Load |
|---|---|
| Changed code uses `@grest-ts/*` packages | `references/grest-ts.md` — only the sections for the packages it uses |
| DynamoDB (`@aws-sdk/client-dynamodb`, `@grest-ts/db-dynamodb`, `aws_dynamodb_table`, `CreateTable` inputs in code) | `references/dynamodb.md` |
| Long-running services, workers, crons, websockets, caches, retries, fleet agents | `references/multi-instance.md` |
| IaC files changed (Terraform/CDK/CloudFormation/Beanstalk/k8s/compose), or audit mode | `references/infra.md` |
| No scale profile found | `references/scale-profile.md` |

For a "more than one instance" finding in diff mode, grep the IaC for that service's instance count instead of loading `infra.md`. It decides whether the problem is live or latent.

## Checklist

**Classify every table or collection you touch as bounded or growing.** Most tables in a system stay small; a few grow with history and carry most of the load.
- **Bounded** needs a named bound: config/settings, lookup or enum tables (plans, roles, regions), seed/static data, a fixed external set, or a per-parent count capped *in code* (max 20 webhooks per org, enforced on create).
- "Few customers", "internal tool" and "small today" are not bounds. Neither is a single-process design: it bounds instance-count issues, not data. Without a named bound, treat it as **growing**.
- Bounded tables may be loaded whole and filtered in memory. Growing ones may not, whatever the profile. A bound limits rows, not bytes or frequency: a bounded row holding a growing list is a Data shape finding, and reloading a bounded table per request is a code-side cost (cache it).

**Before reporting anything else, name what bounds it**: a `limit` on the fetch or a cap enforced in code. If you can name a real bound, don't report it. Filtering inside one bounded page is fine. A `limit` whose cursor is ignored is truncation, not a bound.

**Data shape** (hard to change later — not reduced by the profile)
- Partition/primary key that doesn't serve the main access patterns, or that concentrates writes (constant, low-cardinality, or ever-increasing keys on one partition).
- Rows in multi-tenant data without the tenant key, or a key that can't be scoped to a tenant later.
- ID format: too short to stay unique forever, sequential where it leaks or hot-spots, inconsistent across tables.
- A growing list or map embedded in one row (members, events, history) instead of child rows.
- Persisted field names and stored enum values that are vague, overloaded or misspelled. Renaming later needs a backfill and a dual-read period.
- Times stored as local time, mixed formats or mixed units; money as floats.
- Retention and deletion designed in from the start: a TTL/`expiresAt` attribute, a soft-delete marker that can drop rows out of the hot index (sparse).
- List endpoints and event/message schemas whose contract has no cursor or version. Adding one later breaks every client.
- Adding a secondary index is comparatively cheap (online backfill), so report a missing index as a finding with the index to add (`plausible` when the schema/IaC isn't in the repo to check). A wrong base key is not cheap to fix.

**Data access**
- Full scan / whole-partition query on a growing table, then `.filter/.find/.some/.sort/.slice` in code → cost O(all rows), grows forever. Every read of a growing table goes through a key or index that matches the query.
- Query with no limit/cursor on a collection that grows → huge responses, memory spikes, or hard library caps. Count growth per *partition* (per tenant/user), and remember soft-deleted rows still count.
- Access pattern with no matching index ("list X by Y" done by loading all X); "get one" done as "list all and find".
- N+1: `await` per item in a loop, whether DB gets or service-to-service calls. Use batch reads or bulk endpoints.
- Aggregates (usage, cost, counts, "latest") computed by loading rows on request instead of rollups or a sorted index with limit 1.
- Pagination done after fetching everything. Offset paging on large or changing sets is O(offset) and skips or duplicates rows; use keyset/cursor paging.

**Data lifecycle**
- Soft-deleted or historical rows in the same index the hot path reads. If retention is deliberate, the fix is a sparse/live index, not deleting the rows.
- History/log/event/session tables or object-storage prefixes with no TTL, lifecycle rule or retention.
- Records that accumulate lists/maps forever.
- Hot keys: one constant or low-cardinality key absorbing most reads/writes.

**Concurrency and correctness**
- Read-modify-write without a condition/version → lost updates (more likely with more writers or instances). Partial updates that don't bump the version let a stale full write pass the check.
- Uniqueness via "check then insert" against an eventually consistent index → duplicates. Create-if-absent singletons (per-tenant encryption keys, counters, config rows) written unconditionally → two creators, and one loses its data.
- Short random IDs (8 hex = 32 bits: ~1% collision at ~9k rows, ~50% at ~77k) on rows kept forever; inserts that overwrite on collision.
- Leases/locks without a fencing token, or owned by the process instead of the operation (see `multi-instance.md`).
- Timeouts (`Promise.race`, deadline helpers) that stop waiting but don't cancel the work → zombie operations. This is worst before destructive steps, when the abandoned work goes on to delete or destroy after the caller has moved on.
- DB write + publish/enqueue that aren't atomic → lost or phantom events (use an outbox). At-least-once consumers without dedupe by message id.
- Un-awaited native promise without `.catch` → crashes the process (Node ≥ 15).

**State and instance count** (details: `references/multi-instance.md`)
- In-memory pub/sub, sessions, waiters, work queues, quota-enforcing rate limiters, dedupe sets.
- Process-local caches of mutable data with no TTL/version and no cross-instance invalidation, so revocations, rotations and deletes don't propagate. With no invalidation at all it's stale even on one instance — report that as a finding, not debt.
- Timers/crons with no lease that do *shared* work (write rows, send, call external APIs).
- Unbounded `Map`/`Set` caches keyed by user/tenant/entity.
- A service that is single-instance by design: its throughput ceiling (unbounded work per tick), no drain on deploy, and fan-out that makes it the bottleneck.

**Retries, timeouts, external APIs**
- Outbound calls with no timeout, or no deadline passed down (`AbortSignal`). That includes object-storage uploads and calls between your own services.
- Calls between your own services routed through a public load balancer or proxy (idle timeouts, body limits, deploy cut-offs).
- Retries without jitter, without a max-attempts / dead-letter state, or at more than one layer (3 layers × 3 tries = 27×). Retried non-idempotent writes without an idempotency key.
- Third-party calls (GitHub, cloud provider, KMS/STS, LLM APIs) on the request path without a cache; full pagination of user-scoped lists per request; negative results never cached.
- No 429/`Retry-After` handling; rate-limit 403s read as "no access"; one credential/quota shared by all tenants; polling without backoff.

**Request path, fan-out, overload**
- Long work inside an HTTP request (bulk copy, builds, mass delete/re-sync) → killed by LB timeouts and deploys, retried in full.
- Unbounded `Promise.all` over a user's/tenant's entities; serial loops whose duration grows O(N) in a request or cron tick.
- Unbounded in-memory queues / no load shedding; one slow downstream able to exhaust shared workers or connections (no bulkhead).
- Large payloads buffered in memory instead of streamed, or stored in object storage with presigned URLs.

**Fleet agents** — processes you run on many hosts that call home (details: `references/multi-instance.md`)
- Each agent's calls × fleet size against one backend: full re-sync instead of deltas, request bodies that outgrow size caps, auth or permission resolution redone per call.
- Per-host growth on long-lived hosts: files re-parsed every tick, logs without rotation, state that only grows.

**UI / clients**
- Server cost per UI action: users × tabs × items × frequency. Write the formula in `Caller`.
- Fetch-all then filter/search/paginate in the browser; unvirtualized lists of unbounded size.
- Polling or heartbeats that fan out per item × per tab; reconnect without jitter; replaying every subscription on reconnect.
- One socket/subscription per row; broadcast responses meant for one requester.

**Infra** (details: `references/infra.md`)
- Max instances = 1, single AZ/location/subnet/NAT, burstable instances on hot paths, all-at-once deploys without drain, proxy defaults, hard platform caps.

## Calibrating severity

Severity = impact × likelihood at the scale in the system profile.

- **critical** — fails outright (errors, data loss or corruption of money/permissions/ownership/identity, duplicate accounts, cross-tenant leak) at the profiled scale. Cross-tenant impact stays critical even when rare, if it's expected about once in 10 years or more often at that scale.
- **high** — cost/latency grows with history or tenant size on a hot path (per request, page load, tick); quota exhaustion; lost updates on ordinary data.
- **medium** — same pattern on a cold path, or bounded but large.
- **low** — theoretical or far away; races whose worst case is a soft cap exceeded by one.

Hard caps turn "slow" into "fails": an unbounded read that throws past a limit (grest-ts `query()` at 10k rows) is **critical** if the partition plausibly reaches it within about a year. Estimate it as growth units per day × days, including deleted rows. Otherwise it's **high**.

Weigh the caller. When it's unknown, assume the likely one and say so in `Caller`. The same scan of a growing table is critical behind a page polled every 5 s and medium behind a monthly admin export (critical either way if a hard cap makes it fail outright). For code-side issues, a rare caller can take it down to low.

An internal or small system lowers severity only for code-side issues driven by user or tenant count (caches, fan-out, instance count). Something that is critical for a SaaS can be `low` on a 20-user internal tool; still report it if the system is meant to grow. Data-side issues are **never** lowered by the profile: unindexed or load-all reads of a growing table, and Data shape problems, are at least **high** on a hot path and **medium** elsewhere, because data keeps growing and the shape gets harder to change with every row and client. Growth driven by history (rows per user per day, kept forever) isn't reduced by a small user count.

Don't flag: single-process CLIs/scripts, test code, local-dev adapters, style, micro-optimizations. For a per-host agent, don't flag its in-memory state; do flag its per-host growth and its load on shared services.

## Scale debt (deliberate trade-offs)

Some simpler choices are made on purpose: one instance with in-memory state, no cache, a shared credential "for now". These aren't defects. They are **scale debt**: they set a ceiling. List each one **once**, in its own section, not as a finding. If nobody knows whether it was deliberate, list it anyway, marked `(deliberate? unconfirmed)`, with an `Escalates:` line saying what it becomes if it wasn't.

```
- <choice> — `file:line` / guard (comment, IaC setting, doc)
  Ceiling: <what it caps and at roughly what scale>
  Revisit when: <trigger — e.g. a second instance is needed, a tenant passes N, the first deploy-time event loss>
  Proper fix: <shape and rough size>
```

**Stateful instances always go here**: in-memory pub/sub, sessions, socket registries, local locks or caches that the design depends on. They are the most expensive debt to pay down later.

Only code-side choices can be debt. Data shape problems and load-all reads of a growing table are always findings, even when deliberate — they get harder to fix with every row written.

Still report a **finding** (not debt) when:
- the guard is broader than the choice — for example, an instance cap meant for one service also pins unrelated stateless ones;
- the assumption is already false — rolling or immutable deploys run two copies, another process writes the same rows, one tenant is already near the ceiling;
- a cheap mitigation is missing that makes the debt hurt more than it has to — no drain, no resync after reconnect, no jitter.

In diff mode, the Scale debt section holds only debt the change touches. A change that **deepens** existing debt (new in-memory state, a new consumer of a single-instance component) gets a one-liner, even when it's fine at today's scale, so the trade-off is made consciously: `DEBT — <choice>, deepened by <change> — <ceiling> — file:line`. Debt the change **introduces** gets the full entry above.

## Finding format

```
### <SEVERITY> — <one-line title>
`path/to/file.ts:42` (+ related `file:line`s)
- Breaks: <what fails, roughly at what scale>
- Caller: <who triggers it, how often — a formula for fan-out>
- Fix: <concrete change: index/key, API to use, where the work should move>
- Escalates: <optional — "critical once X">
- Confidence: confirmed | plausible
```

One finding per fix: when several symptoms share a fix (a lost update and a growing embedded list both solved by child rows), report them together and list each under `Breaks`.

**Report layout:**
1. Start with the system profile (or the assumption you made).
2. Then findings, most severe first.
3. Then **Scale debt**.
4. In diff mode, give medium and above in full and lows as one line each (`LOW — title — file:line`). If nothing survives: "No scalability issues in <N> changed file(s)."
5. In audit mode, include a short table inventory — each table: bounded (bound) or growing (growth driver), and the access patterns that lack an index — then finish with the 3–5 root causes that explain most findings and a suggested fix order.
6. If the profile was missing, end with the suggested "Scale profile" section to add.
