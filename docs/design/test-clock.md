# Test clock: one fake time across the test and its runtimes

Status: **implemented** (phases 1 and 2; README: `packages-tooling/testkit/testkit/README.md`, "Controlling
time"). Where this text and the code disagree, the code wins. The driver is kratt, where expiry,
retention and grace-period tests seed old timestamps, inject `now`, or wait in real time. The
problem applies to any grest-ts app whose tests run runtimes with `GGTest.startWorker`.

## Problem

- `vi.useFakeTimers` patches the globals of one isolate. Each `startWorker` runtime has its
  own, so a fake clock in the test never reaches the code under test.
- Kratt works around it three ways, and all three cost something:
  - **`now` seams.** kratt's test rules ban them; five were removed in kratt#1691 and about ten
    remain (`WorkspaceTimersJob`, `PatchStateJob`, `ImageBuildCleanupJob`, `OrgAuthz`,
    `PipelineRunStore`'s `Clock`, and others).
  - **Backdating rows** with raw `UpdateCommand`s. Examples: `approvalExpiryFlow`'s `lapse()`,
    `offboardingFlow`'s `backdateDeactivation`, and `fixtures/setWorkspaceTimers.ts`. The last
    one re-derives the store's index keys and is documented as "Fakes time".
  - **Real waits.** `socketTokenExpiry` uses a 2 s token and a 5 s `waitFor`;
    `hubCronMultiInstance` waits up to 15 s for real ticks; `hubCronBoot` sleeps 2 s.

## Decision summary

| What | Faked? | How | Phase |
|---|---|---|---|
| `Date`, `Date.now()` in the test isolate and every runtime (inline, worker, isolated) | **Yes** | Global shim; an offset (or a frozen instant) pushed over the testkit IPC | 1 |
| `performance.now()`, `process.hrtime` | **Never** | Monotonic time is how elapsed time, timeouts and liveness are measured | — |
| Timers scheduled through `GGLocator.setTimeout/setInterval` (scope timers) | **Yes** | The testkit tracks them; `advance()` fires the due ones | 2 |
| `GGJobRunner` schedule and the `withLock` heartbeat | **Yes** | They already use scope timers | 2 |
| Raw `setTimeout`/`setInterval`/`setImmediate`, `sleep()`, `withTimeout()` | **Never** | Real time. IPC, sockets, HTTP keep-alive, DB client retries, testkit polling and vitest timeouts all live here | — |
| DB and external-service clocks (DynamoDB TTL, MySQL `NOW()`, Redis `EXPIRE`, S3 `LastModified`, MinIO request-time checks) | **No** | Out of reach; see [Databases and external services](#3-databases-and-external-services) | — |

**The line:** a *wall-clock read* (`Date`) is faked everywhere. A *timer* is faked only when
the app schedules it through the framework's scheduled-work API, the scope timers. That API
exists today: `GGLocatorScope.setTimeout/setInterval`, already used by `GGJobRunner` and
`withLock`. Any other timer is IO plumbing and stays on real time. Nothing is inferred from the
call site, so the rule can be checked with grep.

Faking global timers was rejected. A worker's IPC client (`IPCClient.ts:52`, `IPCSocket.ts:219`),
websocket heartbeats, `undici`'s and the AWS SDK's timeouts, and the testkit's own `waitFor` all
share the same `setTimeout`. Faking it hangs the worker. The sinon-style `toFake` is global and
can't tell callers apart.

## 1. What time is faked, and where

### 1a. `Date`: an offset, not a frozen clock (phase 1)

Every isolate gets a `Date` shim at boot, before any app module loads: `worker-loader.mjs`,
`isolated-loader.mjs`, and the `@grest-ts/testkit-vitest` setup file for the test isolate and
inline runtimes. With no clock in use the shim adds offset 0, so it changes nothing.

```ts
const RealDate = Date
let offsetMs = 0, stoppedAt: number | undefined
const now = () => stoppedAt ?? RealDate.now() + offsetMs
function GGDate(this: unknown, ...args: unknown[]) {
    if (!new.target) return new RealDate(now()).toString()
    return Reflect.construct(RealDate, args.length ? args : [now()], new.target)
}
Object.setPrototypeOf(GGDate, RealDate)
GGDate.prototype = RealDate.prototype      // instanceof works for native-created Dates too
GGDate.now = now
globalThis.Date = GGDate as DateConstructor
```

A spike (Node 26) confirmed:
- `instanceof` works on Dates created both ways, including `structuredClone`.
- `Date.parse`, `Date.UTC` and explicit `new Date(x)` are unchanged.
- `d.constructor === Date` is `false`. Setting `prototype.constructor` fixes it; that's an
  implementation detail.

**Time keeps flowing by default.** `set(T)` means "it's T now, and the clock keeps running".
`GGTest.clock.freeze(at?)` really stops it, at exactly `at` in one change (`Date.now()` stays put until the next
`advance`/`set`), and `GGTest.clock.resume()` lets it flow again. Tests that assert on timers or exact times freeze. Flowing is the safer default because code that loops until a `Date`
deadline while waiting on real IO never exits under a frozen clock. kratt has such loops
(`waitForServicesReady`, `GGConfigLocator`'s startup retry, `GGDynamoDbDevTables`). This is the
same model as libfaketime's offset mode.

**Rule for code: `Date` means wall clock, not elapsed time.** A jump of the offset is a wall-clock
jump, the same as an NTP step in production. Code that measures elapsed time with `Date.now()`
sees the jump. Phase 1 therefore includes moving the framework's elapsed-time measurements to
`performance.now()`. That is also a production fix: an NTP step today can falsely close a
websocket as idle.

| Keep `Date` (wall clock, meant to jump) | Move to `performance.now()` (elapsed time) |
|---|---|
| `GGDynamoDbLock`, `GGInstanceLock`, `withLock`'s `holdUntil` | `GGSocket` / `GGRawSocket` `lastActivity` / `idleMs` |
| `GGJobRunner`'s `holdUntil` | `nodeConnectionTransport` agent idle TTL |
| oauth `signedState`, `DynamoOAuthStore`, `GGOAuthServer` | `GGHistogram.startTimer`, Event publisher/subscriber durations, job durations |
| `GGError`/`ERROR` timestamps, `GGLog` timestamps, metrics export timestamps | `GGConfigLocator` startup deadline, `GGDynamoDbDevTables` wait deadline |
| `EventSubscriberClient` `messageAge` (compares with a sent wall time) | testkit: `waitForInterceptors`, `GGTestSharedRef` |
| `GG_TRACE` / `GGTracingMiddleware` start timestamps (wall time sent between processes) | |
| `JwksVerifier` `uat`/`failedAt` (jose writes `uat` with `Date.now()`) | |

`withLock`'s heartbeat (`sentAt - renewedAt >= ttl * 2/3 → lose`) stays on `Date` on purpose.
The lease in the DB is stored in wall time. After an `advance` past the TTL another instance
*would* take the lock, so the local run must see it as lost. This mirrors production: a run
that stalls past its lease loses it.

### 1b. Scope timers follow the clock (phase 2)

The testkit always patches `GGLocatorScope.prototype.setTimeout/setInterval` in every isolate it boots; with the
clock on real time a scope timer behaves as a plain one.
This is the same pattern `@grest-ts/job/testkit` uses for `GGJobRunner.prototype.start`, and
production code doesn't change. Each patched timer:

- Records `{dueAt: Date.now() + ms, fn, intervalMs?}` against the shimmed clock.
- Also arms a real timer for `ms`, so with a flowing clock it still fires by itself. A frozen
  clock arms nothing.
- Returns a stand-in `Timeout` that never fires itself; its `ref`/`unref`/`refresh`/`close` drive the real timer
  underneath, which is re-armed whenever the clock changes.

App code cancels with the global `clearTimeout(handle)`, so the clock has to learn that a timer
was cancelled, or `advance` would fire it anyway. In the runtimes, the testkit wraps the global
`clearTimeout`/`clearInterval` as a pass-through: drop the handle from the clock's list, then
call the real one. Wrapping these is safe where wrapping `setTimeout` isn't, because cancelling
never changes when anything runs.

A scope-timer callback that **returns a promise** has that promise awaited by `advance()`.
Production ignores the return value, so the change costs nothing there. `GGJobRunner`'s
`tick()` changes to return its run, so `advance()` covers a scheduled job's run.

### 1c. GGJob scheduler

There is no special case. Its loop is a chain of scope timers (`JobLoop.schedule`), and its
cooldown is `holdUntil` in wall time. Under `GGTest`, schedules stay off until
`t.x.jobs.start()`, as today. `jobs.run(name)` stays the default way to run a job. The clock
adds:

- **`jobs.start()` then `advance()`:** scheduling tests with no `vi.waitFor` on real ticks
  (kratt's `hubCronMultiInstance`), including the `oneInstance` cooldown. `jobs.run()` releases
  its lock when done, so the cooldown only applies to scheduled ticks.

### 1d. What stays on real time, and why

| Stays real | Because |
|---|---|
| Raw `setTimeout`/`setInterval`/`setImmediate`/`queueMicrotask` | IO, retry, debounce, heartbeat. App business timers that should follow the clock move to `GGLocator.setTimeout` (an explicit opt-in) |
| `sleep()`, `withTimeout()` (`@grest-ts/common`) | Backoff and IO guards |
| `performance.now()` | Elapsed-time measurement |
| Testkit internals, IPC, discovery, vitest test/hook timeouts | Raw timers plus `performance.now()` once phase 1 has moved them |
| TLS certificate validity | OpenSSL reads the OS clock. A certificate the app mints at fake time (`notBefore = new Date()`) fails CA-verified checks after a forward `set` |
| File mtimes (`fs.stat`), child processes (`git`, CLIs), `vm` contexts | The OS clock, or a separate global. A cleanup that compares `mtimeMs` with `Date.now()` sees every file as old after an advance |
| `Temporal.Now`, `Intl.DateTimeFormat().format()` with no date | Phase 1 fixes shim `Temporal.Now`. Intl's implicit now is not shimmed: pass a date |

### 1e. Keeping the line visible: lint, not a runtime throw

Every business timer moves to `GGLocator.setTimeout`, so anyone reading the code, people and
agents alike, sees the pattern. Raw timers are enforced at **lint time**:

```js
// kratt eslint.config.mjs, server code
"no-restricted-globals": ["error",
    {name: "setTimeout",  message: "Business timer: GGLocator.setTimeout (follows GGTest.clock). IO wait: sleep()/withTimeout() from @grest-ts/common, or disable this line with the reason."},
    {name: "setInterval", message: "Periodic work: a GGJob. Business timer: GGLocator.setInterval. IO: disable this line with the reason."}]
```

Throwing at runtime under tests doesn't work. Libraries (undici, the AWS SDK, `ws`, DB
drivers) and the framework's own IO all call the same global `setTimeout`. Telling app code
apart would mean taking a stack trace on every timer and matching file paths, which is costly
and breaks under bundling. About 60 of kratt's own raw timers are also legitimate IO. Lint is
exact at the source, has no runtime cost, and shows up when the code is written. grest-ts
documents the rule (README and the `CLAUDE.md` anti-patterns, next to "setInterval → GGJob");
each app turns it on in its own lint config.

## 2. How it reaches the workers

This uses the existing extension mechanics; there's no new transport.

- **Commands:** `GGClockIPC.worker.set({offsetMs, stoppedAt})` and `.fireDue()`; a reset is a `set` to real time.
  They're registered through `GGTestRuntimeWorker.onBeforeRuntimeStart`, like `GGConfigIPC`. A runtime boots on
  the clock it was started under: its loader gets the state in the runtime config (`config.clock`) and applies it
  before any app module loads.
- **One source of truth:** the test isolate. Workers receive the absolute offset, never a delta,
  so a lost or repeated message can't make them drift.
- **Lifecycle:** a `GGTestComponent`, like `GGConfigTestComponent`. A clock set in `beforeAll` or
  at describe level holds for that block. Set in the top describe, it's a runner hook (like
  `GGTest.with(...).clone()`) that runs before the describe's runtimes start, so they boot on it. After a
  test or block only frozen or flowing is restored, never the time (see "Time only moves forward"); the next
  top describe starts on real time. Real time is the default.

### What `advance(ms)` guarantees when it resolves

`advance` is a **jump, like a machine waking from sleep**. It is not sinon's fast-forward. When it
resolves:

1. Every isolate (the test, inline, worker and isolated runtimes) reads the new time. This is a
   barrier: every runtime acknowledged the new offset before any timer fired. A timer in A that
   calls B therefore always finds B on the new time.
2. Every scope timer pending before the advance and due by the target has fired **once**. Within
   a runtime they are started in due order and run concurrently, as overdue timers do after a
   pause. "Due" means due by the advance target, decided at the barrier. Runtimes fire one after another, in start order. If A has a
   timer due at +2 min and B one at +1 min, `advance(5 min)` fires A's first. Global due order
   would need a round-trip per due instant, and it only matters when one runtime's timer depends
   on another runtime's timer having already run. Revisit if a real test needs it.
3. Intervals fire once, not once per missed period, and continue from the new time. Timers
   that fired callbacks create are scheduled from the new time. To see N runs, advance N times.
4. Every promise returned by a fired callback has settled. A rejection fails the `advance`, but
   only after every runtime has fired its timers, so one failure can't strand another runtime's
   timers. A callback still pending after a real-time guard fails the `advance` with the place its
   timer was set. The guard defaults to the current test's timeout less a margin.

It does **not** guarantee:

- Work a callback started without returning it (use `.waitFor(...)` as today).
- Raw timers.
- Requests in flight during the advance, which may see either time. Don't advance concurrently
  with calls.

```
test isolate            worker A                 worker B
advance(30m)
  set offset ─────────► set offset, ack ◄─────── set offset, ack
  fireDue ────────────► fire due timers in order
                        await returned promises
                        ack ────────────────────►
  fireDue ──────────────────────────────────────► fire, await, ack
resolve
```

Why jumping, not stepping: kratt's job loops check every 60 s. Fast-forwarding 30 days would be
43 200 ticks per job, each with a lock round-trip. Jump semantics are bounded and match what
production does after a VM pause: overdue timers fire once.

## 3. Databases and external services

**Principle: the fake clock is the app's clock. A server that reads its own clock is outside
it.** Moving a container's clock isn't an option either: containers share the host kernel's
`CLOCK_REALTIME` (Linux time namespaces cover only `MONOTONIC` and `BOOTTIME`), so `date -s` in
a container sets the host's clock. The pattern that makes code testable is the one that's already correct in production: the
app decides time and passes it in.

| Case | Covered? | Recommended pattern |
|---|---|---|
| DynamoDB conditions and queries (`lockedUntil <= :now`, `timerDueAt <= :now`) | **Yes** | The app passes `Date.now()`; nothing to do |
| DynamoDB TTL deletion | **No.** dynamodb-local never deletes, and AWS deletes up to days late | TTL is garbage collection only. Reads filter `expiresAt > now` in the app, as `DynamoOAuthStore.ts:105` and kratt's `McpConnectionService` do. Test the filter, never the physical deletion |
| MySQL / Postgres `NOW()`, `CURRENT_TIMESTAMP`, column defaults | **No** | Pass time as a parameter (`WHERE expires_at < ?`). SQL clocks are out of scope for now |
| Redis/Valkey `EXPIRE`, `PX` | **No** | Use relative TTLs and test with short real TTLs. Never `PEXPIREAT` an app-computed absolute time: it's off by the offset |
| S3 `LastModified` | **No** (server time) | Store the app's own timestamp in metadata or the DB when logic depends on it |
| AWS SigV4 (S3, MinIO) | **Mostly.** Spike: dynamodb-local accepts any skew; MinIO rejects more than 15 min with `RequestTimeTooSkewed`. The SDK corrects `systemClockOffset` from the response and retries, so each client loses one attempt per jump. With `maxAttempts: 1` it fails | Keep SDK retries on. See the next row for presigned URLs |
| Presigned URLs (MinIO checks `X-Amz-Date`/expiry against real time) | **No** when the signing client hasn't made a request since the jump | Don't advance more than the URL TTL (kratt: 300 s) around presign flows. If a test needs it, the client's owner registers a clock hook (§3a) that keeps `systemClockOffset` at `-offset` |
| JWT `iat`/`exp` between runtimes and the test (`GGAuthAccessToken`, jose) | **Yes.** Every isolate shares the offset | Tokens minted *before* an advance expire *after* it, which is correct. The test handles it (log in after advancing); the testkit doesn't paper over it |
| Tokens from a real external IdP, and fakes that run outside `GGTest` | **No** | Fakes started as GGTest runtimes (kratt's fakegit, if it is one) share the clock automatically |

### Time only moves forward

The tests of a describe share its runtimes and their data. An automatic undo after each test (the first
implementation) was a backwards jump under live runtimes, which production never makes: state written at fake
time stayed in the future (a scheduled job's lock held until T+40d left later `jobs.run` calls `BUSY`, rows
stamped at T+40d won "latest" queries, wall-time caches stayed cold), and tokens minted at T+40d were used again
at T. So after a test or block, only frozen or flowing is restored; time stays where it was left, and each top
describe starts on real time. Tokens minted before an advance expire with it and fail loudly, as in production.

A test may still set the clock back explicitly. A pending scope timer then waits at most its own delay from the
new time (its due time is clamped on every clock change), so an interval that ticked at T+30d doesn't go quiet
for 30 days.

### Concurrent tests

There is one clock per isolate. `test.concurrent` / `describe.concurrent` share it, and their
changes interleave. Don't use the clock in concurrent tests.

### 3a. Clock hooks for clocks the framework doesn't own

Some third-party code has to follow the clock and can't be shimmed, for example an SDK's own
clock offset. For those there is a test-side hook registry:

```ts
// <package>/testkit/index-testkit.ts — loaded into every runtime and the test isolate
// by the existing GGExtensionDiscovery("testkit"); production never imports it.
import {GGTestClock} from "@grest-ts/testkit"

GGTestClock.onChange(({offsetMs}) => { /* resync the SDK's clients */ })
```

Hooks run inside the `set`/`advance` barrier, before the runtime acknowledges, so they finish
before any timer fires. The framework ships no hooks. A hook is added by whoever owns the client:
kratt's `libs/aws`, the first time a presign test needs it.

## 4. API

```ts
import {GGTest} from "@grest-ts/testkit"

GGTest.clock.set(new Date("2026-03-01T09:00:00Z"))   // every isolate; flowing from T (a frozen clock stays frozen at T)
GGTest.clock.set(Date.now() + 40 * DAY)              // number = epoch ms
GGTest.clock.freeze(T)                                // stops at exactly T (default: now) until advance/set/resume
GGTest.clock.resume()                                 // flowing again from where it stopped
await GGTest.clock.advance(30 * 60_000)               // jump, fire due scope timers, settle (§2)
// Time only moves forward across the tests of a describe; each top describe starts on real time.
```

- It lives on `GGTest`, like `GGTest.waitFor`. Every runtime in the test is on the same clock,
  as in production, where all instances share one wall time. Per-runtime skew
  (`t.cron.clock.skew(ms)`) is left out. The IPC payload is an absolute offset per runtime, so
  it can be added later without a redesign if a real test needs it.
- `set`, `freeze`, `resume` and `advance` return promises that resolve once every runtime has acknowledged.
  Called in the top describe they run as a runner hook before its runtimes start, like `GGTest.with(...).clone()`;
  in a nested describe, in its `beforeAll`.
- Durations are `ms` numbers, consistent with `intervalMs` and `timeoutMs` elsewhere.
- **Production-side API:** none in phase 1. In phase 2 the existing
  `GGLocator.setTimeout/setInterval` becomes the documented "business timer" API: *schedule a
  timer this way when tests must control it*. `GGJobRunner.tick` returning its run is internal.

### Before and after (kratt)

**Approval expiry.** The test no longer writes a backdated row behind the store's back:

```ts
// before: approvalExpiryFlow.test.ts
const lapse = (grantId: string) => doc.send(new UpdateCommand({TableName: "kratt.approvals.grants", Key: {grantId},
    UpdateExpression: "SET requestExpiresAt = :t REMOVE purgeAtSec", ExpressionAttributeValues: {":t": Date.now() - 1_000}}))
await lapse(requestId)
await t.cron.jobs.run("approvals.pending-expiry").toMatchObject({result: "DONE"})

// after
await GGTest.clock.advance(requestTimeoutMs + 1)   // the timeout the request was created with
await t.cron.jobs.run("approvals.pending-expiry").toMatchObject({result: "DONE"})
```

**Workspace timers.** The `now` seam goes, and the test reaches `getDataSet`'s `timer-due-index`
query, which it bypasses today:

```ts
// before: WorkspaceTimersJob.ts
export interface WorkspaceTimersDeps { ...; now?: () => number }
this.now = deps.now ?? Date.now
// workspaceTimers.test.ts
const job = t.workspaces.timersJob(SETTINGS, {ownerGone, retentionMs: () => 30 * DAY, now: () => now})
await job.processRow(ws.workspaceId)

// after: production reads Date.now(); the test drives it
await GGTest.clock.advance(5 * 60_000)
await runJobOnce(job)        // or t.cron.jobs.run("vm.workspace-timers") in a flow
```

This works in-process too, because the test isolate's `Date` is shimmed. The lifecycle harness
needs no worker.

**Offboarding.** It drives the real deactivate API, then advances, instead of rewriting
`deactivatedAt`, `parkAt` and `deleteAt`:

```ts
// before: offboardingFlow.test.ts
deactivatedAt -= ACCESS_TOKEN_TTL_MS + 60_000
await backdateDeactivation(userId, deactivatedAt)
await setTimers(workspaceId, {deleteAt: Date.now() - 1})

// after
await admin.users.deactivate({userId})
await GGTest.clock.advance(ACCESS_TOKEN_TTL_MS + 60_000)
await t.cron.jobs.run("vm.deactivated-users-workspaces")
await GGTest.clock.advance(RETENTION_MS)
await t.cron.jobs.run("vm.workspace-timers")
```

**Socket closes at token `exp`** (phase 2, plus a one-line kratt change):

```ts
// kratt production: authWires.ts closeAtTokenExpiry
- return setTimeout(() => outgoing.close(), Math.max(0, Math.min(...exps) * 1000 - Date.now()))
+ return GGLocator.setTimeout(() => outgoing.close(), Math.max(0, Math.min(...exps) * 1000 - Date.now()))

// test: no 2 s token, no 5 s vi.waitFor
let token = await mintUserToken(60_000)
...
token = await mintUserToken(10 * 60_000)
await GGTest.clock.advance(60_000)
expect(handshakes).toBe(2)      // close fired during advance; the reconnect may still need .waitFor (it's IO)
```

**Job scheduling** (phase 2):

```ts
await t[0].jobs.start()
await GGTest.clock.advance(5_000)   // replaces hubCronMultiInstance's 15 s vi.waitFor on real ticks
```

## 5. Interaction with `vi.useFakeTimers`

- **They own different scopes.** `vi.useFakeTimers` is for pure in-process unit tests of a
  loop's timing, with everything in one isolate. `ServiceControllerReady`, kratt's
  `agentManagerHarness` and grest-ts's `withLock.test` keep it. That's the right tool there, and
  kratt shouldn't move them. `GGTest.clock` is for anything with a runtime or a test isolate that
  has to agree with one.
- **In one test, don't fake `Date` with both.** `vi.useFakeTimers()` (whose default `toFake`
  includes `Date`) installs over the shim. vitest restores the shim on `useRealTimers()`. While
  it's active, the test isolate diverges from the workers. `GGTest.clock.*` throws a clear error
  when `globalThis.Date` isn't the shim ("vi.useFakeTimers faked Date; leave Date out of toFake,
  or use GGTest.clock").
- **`vi.useFakeTimers({toFake: ["setTimeout", ...]})` without `Date` is fine** with worker
  runtimes. With *inline* runtimes it also fakes the real timers phase 2 arms; don't combine them.
- **Date-only uses of vi become `GGTest.clock`** where the test is cross-isolate:
  `vi.useFakeTimers({toFake: ["Date"], now})`, as in kratt's `ImageBuildScheduleJob.test` and
  grest-ts's `GGOAuthServer.test`. Pure unit tests may keep vi.

## 6. Phases

| Phase | Scope | Effort | Risk |
|---|---|---|---|
| **1. `Date` everywhere** | Shim in the three loaders; `GGClockIPC.set`; `GGTestComponent` restoring frozen/flowing per test or block; the boot clock in the runtime config; `GGTest.clock.set/freeze/resume/advance` (Date only); vi detection; move the framework's elapsed-time sites (table in §1a) to `performance.now()`; README-testkit section; testkit tests across inline, worker and isolated | 2–3 days | **Low–medium.** Third-party `Date` reads (SigV4 skew handled by retry, presign not); tokens minted before an advance expire; log timestamps show fake time, which is arguably correct. Code that captured `Date` before the shim is unaffected; the loader installs the shim first |
| **2. Scope timers and job scheduler** | Patch `GGLocatorScope` timers under the clock; `fireDue` with await-returned-promise and a real-time guard; pass-through wrap of the global timers (cancel tracking plus the raw-timer warning on `advance`); scope timers cleared on runtime teardown; `GGTestClock.onChange` hooks; `GGJobRunner.tick` returns its run; job README "Testing" section; tests for cooldown, interval coalescing and a timer cleared before the advance | 3–4 days | **Medium.** A callback that awaits something the test must do first deadlocks until the guard; cross-runtime ordering is by start order, not due time |
| **3. kratt adoption** (kratt repo, not framework) | Delete the `now` seams and their tests' fakes; replace backdate helpers; move **all** business timers from raw `setTimeout` to `GGLocator.setTimeout`, so the codebase shows the pattern; an ESLint rule on raw timers (§1e) | Per file; about 2–3 days for the list in §7 | Low; each conversion stands alone |
| *Not planned* | DB and container clocks (including MySQL/Postgres `NOW()`); global timer faking; per-runtime skew; a runtime throw on raw timers | — | — |

## 7. What kratt can delete or simplify

These were found by survey on 2026-11-12 and need re-checking at adoption time.

**Phase 1 (`Date` only):**
- `now` seams and the fakes feeding them:
  - `WorkspaceTimersJob.ts:14,30` + `workspaceTimers.test.ts:20,69`
  - `PatchStateJob.ts:27` + `patchStateJob.test.ts:17`
  - `ImageBuildCleanupJob.ts:34` + its test
  - `OrgAuthz.ts:60` + `OrgAuthz.test.ts:44`
  - `RemoteBrowserService.ts:55` + its test
  - `GitHubInjection.ts:47`, `RelayTycoonCallbackApiImpl.ts:10`, `PipelineInternalApiImpl.ts:20`
  - `PipelineRunStore`'s `Clock` (`engine.test.ts`, `runView.test.ts`)
- Relay-side seams that run in-process (`AgentQueueStore`, `TaskListManager`, `TabSweeper`) can
  use `GGTest.clock` or `vi.useFakeTimers` today. That's a kratt clean-up either way.
- Backdating helpers:
  - `fixtures/src/setWorkspaceTimers.ts` (whole file; it duplicates the store's index-key derivation)
  - `approvalExpiryFlow`'s `lapse()` and the raw `SET outcome` at :94
  - `offboardingFlow`'s `backdateDeactivation`, `setTimers` and about 14 `Date.now() - 1` rewrites
  - `idpSessionCheckFlow`'s `backdate()`
  - `secretRequestFlow`'s `longAgo` grants
  - `chatRetention`'s `longAgo` seeds, where the relay can push at "now" and the test then advances 40 days
- Becomes a flow: `ImageBuildScheduleJob.test` (fake `Date` for build slots) can move into hub-cron.

**Phase 2 (scope timers):**
- `socketTokenExpiry.test.ts`: the 2 s TTL and 5 s wait, after the one-line `closeAtTokenExpiry`
  change.
- `hubCronMultiInstance.test.ts`: the 15 s wait on real ticks.
- `hubCronBoot.test.ts:28`: the 2 s sleep, if the pipeline workers' first claim is a scope timer.
  Today it's `WorkspaceFlowWorker`'s raw loop; that is a kratt decision.
- The scheduled `oneInstance` cooldown becomes testable at all.

**Stays as is:**
- `ServiceControllerReady` and the other in-process `vi.useFakeTimers` tests.
- `offboarding.test.ts`, which is DynamoDB failure injection.
- `TranscriptRetentionJob.test.ts`, which tests paging.
- Live-VM sleeps in `integration-tests/tests`, which are real infrastructure.

**Seeding is still legitimate** when the state can't be reached through an API, or when the
seed is the clearer statement (such as "a session last active 40 days ago"). The clock removes
the seeds that only exist to fake elapsed time, especially those that duplicate store logic.

## 8. Decisions (owner review, round 1)

| # | Topic | Decision |
|---|---|---|
| 1 | Default | Flowing. `GGTest.clock.freeze(at?)` really stops it; `resume()` resumes |
| 2 | Per-runtime skew | Not built. All runtimes stay in sync; the per-runtime offset payload leaves room to add it later |
| 3 | Order in `advance` | Barrier first (every runtime on the new time), then timers fire runtime by runtime in start order. No global due-time stepping: code that depends on which runtime's timer fires first is racy in production too |
| 4 | Cancelled timers | The testkit wraps global `clearTimeout`/`clearInterval` as a pass-through. No Node internals, no new API |
| 5 | Third-party clocks (SDK SigV4, presign) | Generic `GGTestClock.onChange` hook, registered from a package's `testkit/index-testkit.ts`. The framework ships none |
| 6 | MySQL/Postgres `NOW()` | Out of scope for now |
| 7 | Tokens expiring after an advance | Correct behaviour, and the test's job (log in after advancing). Not a testkit concern. If "stay signed in across a jump" is ever wanted, it belongs in the auth library, not the clock |
| 8 | Library time semantics (`JwksVerifier` key-cache age and similar) | Each library's own call, not a testkit concern. Rule of thumb for grest-ts libraries: elapsed time uses `performance.now()`, wall-clock deadlines use `Date` |
| 9 | kratt's raw business timers | Move all of them to `GGLocator.setTimeout` in phase 3, and enforce with an ESLint rule, not a runtime throw (§1e) |
| 10 | A `realTimeout()` helper | No, unless eslint-disable lines for raw timers become common |
| 11 | `GGLocator.setTimeout` in production code | Fine. It already exists and the job runner and `withLock` use it. It runs the callback inside the runtime's scope. Outside a scope it is a plain timer (CLIs); under the testkit it warns once per call site; tests have the testkit's root scope. Follow-up: the runtime scope tracks its timers and clears them on teardown, so a stopped runtime leaves none behind. No request-bound auto-cancel: a timer's lifetime belongs to the object that owns it (a socket clears its expiry timer on close), and "cancel when the request ends" is wrong for timers set during a request that must outlive it |
| 12 | Taking over global timers | **Observe, don't fake.** In runtimes the testkit wraps `setTimeout`/`setInterval`/`clear*`. Scope timers follow the clock; every other timer runs on real time through the native functions. When an `advance` jumps past a pending raw timer created by app code, the testkit warns with the timer's creation site ("use `GGLocator.setTimeout` if it should follow the clock"). Capturing that site needs a stack trace per timer, so it is opt-in or limited to long timers. Fully faking every timer was rejected: `freeze()` would hang IO (retries, backoff, polling); `advance` would fire unrelated IO timers that it doesn't wait for; and timers that bypass the globals (`timers/promises`, `AbortSignal.timeout`, undici, socket timeouts) would make the line arbitrary |

## 9. Open questions

None at the moment.
