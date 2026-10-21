---
name: scalability-review
description: Review code for things that break with more users, bigger tenants, longer history, or more than one instance of a service — whole-table loads filtered in code, unbounded queries, missing indexes, N+1, in-memory state that assumes one process, races, unbounded fan-out, external API quotas, single-instance infra. Use when asked to check scalability, "will this scale", before finishing a feature (diff mode), or for a full-repo scalability audit. Knows grest-ts-specific failure modes.
---

# Scalability review

Find code that works today and breaks at N: more users, bigger orgs/tenants, more history, more traffic, or more than one instance of a service. Report only what will actually break or degrade, with a concrete scale and a concrete fix — not style.

## Modes

The mode comes from the invocation arguments (`$ARGUMENTS`: `diff`, `audit`, optionally a path) or the user's request. Default is **diff**.

- **diff** — review what this branch changed. Base branch = first of `main`/`master`/`dev`/`develop` that `git rev-parse --verify` resolves; files = `git diff --name-only $(git merge-base HEAD <base>)...HEAD` plus uncommitted/staged changes. Read each changed hunk *and* the code it calls into (a new list endpoint is only as good as the store method behind it) and its callers (a harmless helper becomes a problem when called per row or per request), one hop each way. Report problems the change introduces or puts on a hotter path; a pre-existing problem found one hop away goes under a separate "Nearby, pre-existing" heading, not mixed in. Do it yourself, no sub-agents. Meant to run as part of finishing a feature.
- **audit** — whole repo (or the given path). Survey the layout first, then fan out parallel read-only review agents, one per area (e.g. data layer, background jobs/workers, request-serving tier + sockets, feature modules, UI, infra-as-code). Give each agent this file's checklist, the relevant reference files, and the finding format. Merge, dedupe by `file:line`, then spot-check every critical finding yourself before reporting.

## Before you start

Load the references that match the stack — only those:

| Signal | Load |
|---|---|
| `package.json` has `@grest-ts/*` | `references/grest-ts.md` (framework failure modes — highest value) |
| DynamoDB (`@aws-sdk/client-dynamodb`, `@grest-ts/db-dynamodb`, `*.tf` `aws_dynamodb_table`, `CreateTable` definitions in code) | `references/dynamodb.md` |
| Long-running services, workers, crons, websockets, caches | `references/multi-instance.md` |
| Terraform/CDK/CloudFormation/Beanstalk/k8s/compose files changed, audit mode, or any multi-instance finding | `references/infra.md` |

Table/index definitions can live both in IaC and in code (`CreateTable` inputs used for local/test setup) and may drift — check both. For any "more than one instance" finding, grep the IaC for the service's instance count even in diff mode: it decides whether the problem is live or latent.

## Checklist

Each item: what to look for → why it breaks. Treat any filter/sort/limit applied in code over a collection that grows with users or time as a red flag until proven bounded.

**Data access**
- Full scan / whole-partition query, then `.filter/.find/.some/.sort/.slice` in code → cost is O(all rows), latency and cost grow forever.
- Query with no limit/cursor on a collection that grows → huge responses, memory spikes, or hard library caps.
- Access pattern with no matching index ("list X by Y" done by loading all X).
- N+1: `await` inside a loop per item; single gets instead of a batch get.
- Aggregates (usage, cost, counts, "latest") computed by loading rows on request instead of rollups / sorted index + limit 1.
- Pagination done client-side after fetching everything, or "limit" applied after the fetch.

**Data lifecycle**
- Soft-deleted or historical rows sitting in the same index the hot path reads, filtered out in code.
- History/log/event/session tables with no TTL or retention.
- Records that accumulate lists/maps (item-size limits, write amplification).
- One constant or low-cardinality partition key for hot writes/reads (`"1"`, `orgId` for a very large org).

**Concurrency and correctness under load**
- Read-modify-write without a condition/version (lost updates — more likely with more writers/instances).
- Uniqueness enforced by "check then insert" against an eventually consistent index → duplicates.
- Short random IDs (e.g. 8 hex chars = 32 bits: ~1% collision chance at ~9k rows, ~50% at ~77k) on rows kept forever; inserts that overwrite on collision.
- Locks/leases whose owner is the process rather than the operation; leases shorter than the work they guard; heartbeat failures that don't abort.
- Timeouts (`Promise.race`, deadline helpers) that stop waiting but don't cancel the work → zombie operations accumulate.
- Fire-and-forget promises without `.catch` (unhandled rejection can crash the process).

**More than one instance** (details: `references/multi-instance.md`)
- In-memory pub/sub, sessions, waiters, queues, rate limiters, dedupe sets.
- Process-local caches with no TTL and no cross-instance invalidation (revocations, credential rotation, deletes don't propagate).
- Timers/cron jobs with no lease — run N times with N instances.
- Unbounded `Map`/`Set` caches keyed by user/tenant/entity.

**External APIs and quotas**
- Third-party calls (GitHub, cloud provider, KMS/STS, LLM APIs) on the request path with no cache; full pagination of user-scoped lists per request.
- No 429/`Retry-After` handling; rate-limit 403s read as "no access"; fixed retry delays.
- One credential/quota shared across all tenants; polling loops without backoff.

**Request path, fan-out, memory**
- Long work inside an HTTP request (bulk copy, builds, mass delete/re-sync) → killed by LB timeouts and deploys, retried in full by clients.
- Unbounded `Promise.all` over a user's/tenant's entities, or serial loops whose duration grows O(N) in a request or cron tick.
- Large payloads buffered in memory (whole files, transcripts, audio) instead of streamed / stored in object storage with presigned URLs.
- Responses that return whole collections; "get one" implemented as "list all and find".

**UI / clients**
- Fetch-all then filter/search/paginate in the browser; unvirtualized lists of unbounded size.
- Polling or heartbeats that fan out per item × per tab; reconnect without jitter; replay of all subscriptions on reconnect.
- One socket/subscription per row; broadcast responses meant for one requester.

**Infra** (details: `references/infra.md`)
- Max instances = 1, single AZ/location/subnet/NAT, burstable instances on hot paths, all-at-once deploys without drain, hard platform caps (DNS label 63 chars, transaction item limits, provider quotas).

## Calibrating severity

- **critical** — fails outright (errors, data loss, cross-tenant leak) at a scale the product will plausibly reach, or blocks running a second instance.
- **high** — cost/latency grows with history or tenant size on a hot path (per request, per page load, per tick); quota exhaustion; races that corrupt state.
- **medium** — same pattern on a cold path (admin pages, daily jobs), or bounded but large.
- **low** — theoretical or far away; hygiene.

Hard caps turn "slow" into "fails": an unbounded read that throws past a limit (grest-ts `query()` at 10k rows) is **critical** if the collection plausibly reaches the cap within about a year at its write rate (estimate it: rows per user/day × users × days), otherwise **high**.

Known, accepted limits (code comment or IaC saying "single instance until X") — report once with the existing guard named and mark it `known`; in diff mode only re-raise it if the change makes it worse.

Weigh the caller: the same scan is critical behind a page polled every 5 s and low behind a monthly admin export. Say who calls it.

Don't flag: collections that are bounded by design (and say what bounds them), admin-only one-offs, test code, local-dev-only adapters. Don't report style or micro-optimizations.

## Finding format

```
### <SEVERITY> — <one-line title>
`path/to/file.ts:42` (+ related `file:line`s)
- Pattern: <checklist item>
- Breaks: <what fails and roughly at what scale>
- Caller: <who triggers it and how often — page load, per request, per tick, admin-only>
- Fix: <concrete change: index/key, API to use, where the work should move>
- Confidence: confirmed | plausible | known
```

Group by severity, most severe first. Use `plausible` for anything you couldn't confirm by reading the code. In diff mode, if nothing survives: "No scalability issues in <N> changed file(s)." In audit mode, finish with the 3–5 root causes that explain most findings and a suggested fix order.
