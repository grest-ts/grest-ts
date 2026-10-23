# Plan: Testkit improvements

## Goal

Testkit features that remove hand-written test plumbing: polling loops, string-path HTTP helpers, fake clients, log-regex stand-ins for events. Ordered by correctness first, then by how common the underlying need is. Overlaps with `docs/IDEA_LIST_FOR_TESTS.md` are noted per item; time control is covered separately in `SPEC-TESTS_CONTROLLING_TIME.md`.

---

## 1. `.waitFor()` must keep its interceptor registered while waiting (bug)

**Problem.** `GGTestAction.execute()` registers all interceptors, runs the action, sleeps 25 ms, then unregisters **all** of them in `finally` — including `.waitFor` ones — and only afterwards polls `isCalled()` (`packages-tooling/testkit/testkit/src/testers/GGTestAction.ts:199-203`, `_waitForAllInterceptors` at `:277`). HTTP, `@mockable`, events and websocket interceptors really remove their handler on unregister, so `.waitFor(Api.spy.x)` / `.waitFor(socket.mock.x)` only sees calls that arrive during the action or within those 25 ms; a late websocket message additionally hits the "unexpected socket message" handler. Log interceptors are unaffected (their `unregister()` is a no-op), as is the standalone `GGTest.waitFor(...)` (`GGTest.ts:132`).

Tests that wait on a side effect pass only when it happens to land inside the window — timing-dependent, and a source of flakes under load.

**Proposal.** Unregister non-wait interceptors in `finally` as now; unregister `.waitFor` interceptors only after `_waitForAllInterceptors()` resolves or times out (also on failure).

**Verification.** Regression test: an action whose side effect fires a socket message / HTTP call ~200 ms after the response; `.waitFor` on it must pass. Fails on current code.

---

## 2. Retry-until-match on actions: `.eventually()`

**Problem.** State that converges asynchronously (background workers, pollers, queues) has no testkit form. Tests write their own deadline loops around API calls and lose the assertion chain and its error messages.

**Proposal.**

```typescript
await ctx.order.get({id})
    .eventually({timeoutMs: 30_000, intervalMs: 500})
    .toMatchObject({status: "shipped"});
```

- Re-executes the action until all response expectations pass or the timeout hits; failure reports the last response and the last expectation error.
- Optional `failFast: (result) => boolean | string` for terminal states (`status === "failed"` should abort immediately).
- Not combinable with `.with()` interceptors — call counts would be ambiguous. Throw at build time.

**Open question.** Is `execute()` safely re-runnable (trace init, `ctx.run`), or does `.eventually()` rebuild the call from its inputs?

---

## 3. Assertion chain for services not started by the test

**Problem.** Test clients resolve routes only through the local discovery router (`packages/http/http/testkit/clientHttp/GGHttpSchema.callOn.ts:47`). Services the test did not boot — a process on another machine, a staging deployment — can only be reached with a plain `createClient({url})`, which loses `GGTestAction` (`.toMatchObject`, `.toBeError`, `.eventually`). Tests then fall back to hand-rolled HTTP helpers with string paths and untyped bodies, even though the contract exists.

**Proposal.**

```typescript
const ops = new GGTestContext("Ops")
    .apis({orders: OrderApi}, {target: {url: "https://staging.example.com", tls: {fingerprint256}}});

await ops.orders.get({id}).toMatchObject({status: "shipped"});
await ops.orders.get({id: 0}).toBeError(NOT_FOUND);
```

- Mock/spy/config/log features are unavailable for such targets (nothing to intercept); using them throws with a clear message.
- TLS pinning is needed for self-signed / per-host certificates.

**Open question.** Reuse `createClient`'s connection options instead of a parallel `target` shape.

---

## 4. Contract compatibility check

**Problem.** In tests, client and server share the same contract code and codec, so a breaking wire change (renamed field, changed path or verb, removed error type) keeps every test green. That breaks consumers that deploy separately: older clients, mobile apps, services on a different release cadence.

**Proposal.** (Idea #6 in `IDEA_LIST_FOR_TESTS.md`, narrowed.)

```typescript
test("OrderApi wire is compatible", async () => {
    await expect(OrderApi).toMatchContractSnapshot();
});
```

- Snapshot = normalized wire shape per method: verb + path, input/output schema, declared error types.
- Diff classifies breaking (removed/renamed field, newly required input, removed method or error type, changed path/verb) vs additive; only breaking changes fail, additive ones update the snapshot.
- Build on the OpenAPI/AsyncAPI exporters for the normalized shape.

---

## 5. Mocks that can call through: `spyOn(...).override()`

**Problem.** A mock never reaches the real implementation, there is one interceptor per key, and `.times(1)` fails the test on a second call. "Fail the first call, let the retry hit real code" is not expressible; the closest option fakes the success too, so the real success path never runs. `.sleep()` is only a fixed delay. Retry, fallback and recovery logic ends up tested with unit-level fakes instead of through running runtimes.

**Proposal.** (Generalizes idea #2 "Fault Injection".)

```typescript
.with(spyOn(PaymentGateway).charge
    .override(async (input, callReal, n) => n === 0 ? new GATEWAY_TIMEOUT() : callReal(input))
    .times(2))
```

- `n` = zero-based call index for this interceptor.
- Returning an error instance throws it to the caller — for HTTP, events and `@mockable`.
- `callReal` only in spy (pass-through) mode.
- Covers fail-once, fail-every-Nth, input-conditional failures and conditional delays (`await until(...)` inside the override) with one primitive.

**Related fix to confirm.** `mockOf(Svc).m.andReturn(new ERR())` on `@mockable` likely returns the error object as a plain value instead of throwing it (the IPC result is returned as-is unless it is `CALL_THROUGH`: `packages-tooling/testkit/testkit/src/mockable/GGMockableCall.ts:23-39`). Write a test; fix alongside.

---

## 6. Negative expectations over a settle window: `.never()`

**Problem.** `times(0)` only covers the action window. "This must not happen within N ms after the action" — no event leaks to another tenant, no duplicate notification, no retry storm — needs a settle period. Depends on item 1.

**Proposal.**

```typescript
await alice.docs.share({...})
    .waitFor(alice.socket.mock.onShared.toMatchObject({...}))
    .never(mallory.socket.mock.onShared, {settleMs: 300});
```

---

## 7. Ordered expectations: `.expectSequence()`

**Problem.** Multiple `.waitFor`s are checked independently, so "A then B" can't be asserted — e.g. `JobFailed` followed by `JobSucceeded` after a retry. Depends on item 1.

**Proposal.** (Idea #4 in `IDEA_LIST_FOR_TESTS.md`.)

```typescript
await ctx.jobs.run({id})
    .expectSequence(
        JobEvents.spy.failed.toMatchObject({id}),
        JobEvents.spy.succeeded.toMatchObject({id}),
    );
```

---

## 8. HTTP status in `.toBeError()`

**Problem.** `toBeError(X)` compares only the body's error `type` (`packages/http/http/testkit/utils/validateContractResponse.ts:13`); `response.status` is ignored. A server that returns 200 with an error body, or the wrong status for an error, passes. Non-grest consumers (browsers, proxies, third-party clients) depend on the status.

**Proposal.** `toBeError(X)` also asserts the status `X` is declared with (e.g. 404 for `NOT_FOUND`). No API change.

---

## 9. Raw requests with the assertion chain

**Problem.** Typed inputs make malformed requests (wrong types, missing headers, bad JSON, wrong content type) require casts or a drop to `fetch`, losing the assertion chain. Negative input tests are where a framework's validation is most worth testing.

**Proposal.**

```typescript
await ctx.raw(OrderApi.create).send({body: "{not json", headers: {"content-type": "application/json"}})
    .toBeError(VALIDATION_ERROR);
```

---

## 10. Per-test database clone scope

**Problem.** `clone()` isolates per `describe` block (`beforeAll`/`afterAll`); tests in the same suite share data and work around it with unique ids. Some tests need a guaranteed-empty database.

**Proposal.** `GGTest.with(cfg).clone({scope: "test"})` — opt-in, since cloning per test is slower.

---

## 11. Database assertions

**Problem.** `clone()` already returns a typed handle to the runtime's DB client (`GGMysqlTestMethods.ts:117`, `GGPostgresTestMethods.ts:113`, `GGDynamoDbTestMethods.ts:108`, under `packages-libs/db/*/testkit/`), usable as `db.query(...).toMatchObject(...)`, but this is undocumented and has no examples. Asserting persisted side effects (outbox rows, audit entries) is a common need.

**Proposal.** Document the handle with examples; add `rowsToContain(...)` style helpers only if raw usage proves clunky.

---

## 12. Recording & replay at contract boundaries

**Problem.** Reproducing a multi-service flow from a bug report means hand-writing every mock. Interceptors already see all cross-runtime traffic.

**Proposal.** (Idea #5 in `IDEA_LIST_FOR_TESTS.md`.) Record contract-boundary calls during a test run into a fixture; replay them as mocks in another test.

---

## 13. Running suites against deployed environments

**Problem.** Tests that use only contract calls and response assertions could run unchanged against staging as smoke tests, but every test currently requires runtimes the testkit started.

**Proposal.** A suite-level remote mode built on item 3: discovery resolves to configured base URLs; tests that use mocks, spies, config or logs are detected and skipped with a reason, so the portable subset is known automatically.

---

## Suggested order

1 → 2 → 3 → 5 → 8 → 4 → 6 → 7 → 9 → 10 → 11 → 12 → 13.

Item 1 is a small correctness fix that 6 and 7 build on. 2, 3 and 5 remove the most hand-written plumbing. 8 is small and closes a silent gap. 13 is the largest change and should follow 3.
