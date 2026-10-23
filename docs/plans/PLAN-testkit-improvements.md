# Plan: Testkit improvements driven by kratt

## Goal

Close the testkit gaps that a large real consumer (kratt: ~400 test files, hub + socket + relay runtimes, DynamoDB) currently works around by hand. Every item below is backed by workarounds found in kratt's test code; items without that evidence are parked at the end.

Priority order = correctness first, then by how much hand-rolled test code each item removes.

---

## 1. `.waitFor()` must keep its interceptor registered while waiting (bug)

**Problem.** `GGTestAction.execute()` registers all interceptors, runs the action, sleeps 25 ms, then unregisters **all** of them in `finally` — including `.waitFor` ones — and only afterwards polls `isCalled()` (`packages-tooling/testkit/testkit/src/testers/GGTestAction.ts:199-203`, `_waitForAllInterceptors` at `:277`). HTTP, `@mockable`, events and websocket interceptors really remove their handler on unregister, so `.waitFor(Api.spy.x)` / `.waitFor(socket.mock.x)` only sees calls that arrive during the action or within those 25 ms. A late websocket message additionally hits the "unexpected socket message" handler. Log interceptors are unaffected (their `unregister()` is a no-op), which is why log-based waits work. The standalone `GGTest.waitFor(...)` (`GGTest.ts:132`) is also unaffected.

**Kratt usage.** Socket-event expectations such as `.waitFor(admin.socket.mock.onWorkspaceLifecycle.toMatchObject({...}))` in `secretRequestFlow`, `elevatedRequestFlow`, `requestInit` and `pipelineRunsTopic` tests. They pass today only because hub notifies before the HTTP response returns.

**Proposal.** Unregister non-wait interceptors in `finally` as now; unregister `.waitFor` interceptors only after `_waitForAllInterceptors()` resolves or times out (also on failure).

**Verification.** Regression test: an action whose side effect fires a socket message / HTTP call ~200 ms after the response; `.waitFor` on it must pass. Should fail on current code.

---

## 2. Retry-until-match on actions: `.eventually()`

**Problem.** Assertions on state that converges asynchronously (background workers, polling engines) have no testkit form. Each suite writes its own deadline loop, losing the action's assertion chain and error messages.

**Kratt usage.** 15 test-side files with `while (Date.now() < deadline)` loops, plus `KrattTestContext.waitForWorkspaceStatus` (poll `WorkspaceApi.get` until `status` matches, swallow transient errors) and 7 `vi.waitFor` wrappers around API calls. The VM engine runs in a separate cron runtime that ticks every ~3 s, so "eventually" is the normal shape of a lifecycle assertion.

**Proposal.**

```typescript
await admin.workspace.get({workspaceId})
    .eventually({timeoutMs: 90_000, intervalMs: 1_000})
    .toMatchObject({status: "running"});
```

- Re-executes the action until all response expectations pass or the timeout hits; the failure reports the last response and the last expectation error.
- Optional `failFast: (result) => boolean | string` for terminal states (kratt: `status === "failed"` should abort immediately, not wait 90 s).
- Interceptors (`.with`) are not allowed in combination — the call count would be ambiguous. Throw at build time.

**Open question.** Is `GGTestAction.execute()` safely re-runnable (trace init, ctx.run), or does `.eventually()` need to rebuild the call from its inputs?

---

## 3. Assertion chain for services not started by the test

**Problem.** Test clients resolve routes only through the local discovery router (`packages/http/http/testkit/clientHttp/GGHttpSchema.callOn.ts:47`). Services the test did not boot — a runtime on a real VM, a deployed staging service — can only be reached with a plain `createClient`, which loses `GGTestAction` (`.toMatchObject`, `.toBeError`, `.eventually`).

**Kratt usage.** The VM integration flows talk to the relay running on a real VM. With no typed option they call it through a string-path helper: ~88 call sites like `relayRpc<{agent: Agent}>("api/agents/launch", body)` with untyped bodies and hand-asserted response types, although every route is a `GGHttpSchema` contract (e.g. `RelayGitApi`). A renamed route compiles and only fails on a live VM.

**Proposal.** Let a test context target an explicit endpoint per API while keeping the assertion chain:

```typescript
const agent = new GGTestContext("Agent")
    .apis({git: RelayGitApi, agents: RelayAgentApi}, {
        target: {url: `https://${ip}:9600`, tls: {fingerprint256}},
    });
agent.set(RELAY_TOKEN, token);

await agent.git.commitAll({repo: "dummy-node", message: "x"}).toMatchObject({sha: expect.any(String)});
await agent.git.checkout({branch: "nope"}).toBeError(GIT_CONFLICT);
```

- Mock/spy/config/log features stay unavailable for such targets (nothing to intercept); using them throws with a clear message.
- TLS pinning support is needed for kratt's per-VM certificates; if the http client already accepts a pinned agent, `target` just forwards it.

**Open question.** Can this reuse `createClient`'s existing connection options instead of adding a parallel `target` shape?

---

## 4. Contract compatibility check

**Problem.** Client and server in a test share the same contract code and codec, so a breaking wire change (renamed field, changed path or verb, removed error type) keeps all tests green. That is fine when both sides always deploy together, but not when they don't.

**Kratt usage.** Hub and relay deploy independently: running VMs keep the relay bundle they were spawned with until synced (CLAUDE.md: "After changing the relay↔hub wire, Sync them; until then they show NOT_AUTHORIZED"). A wire change between hub and relay is a production incident for every unsynced VM. Kratt already hand-rolls one snapshot of this kind for its agent tool surface (`agentToolConventions.test.ts`).

**Proposal.** Matches idea #6 in `IDEA_LIST_FOR_TESTS.md`, narrowed to what kratt needs first:

```typescript
test("relay wire is compatible", async () => {
    await expect(RelayGitApi).toMatchContractSnapshot();
});
```

- Snapshot = normalized wire shape per method: method + path, input/output schema (JSON-schema-like), declared error types.
- Diff classifies changes as breaking (removed/renamed field, newly required input, removed method or error type, changed path/verb) vs additive; only breaking ones fail; additive ones update the snapshot.
- The OpenAPI/AsyncAPI exporters likely already produce most of the normalized shape — build on them.

---

## 5. Mocks that can call through: `spyOn(...).override()`

**Problem.** A mock never reaches the real implementation, there is one interceptor per key, and `.times(1)` fails the test on a second call. "Fail the first call, let the retry hit real code" is not expressible; the closest option fakes the success too, so the real success path never runs. `.sleep()` is only a fixed delay.

**Kratt usage.** Recovery paths are core behaviour: agent auto-continue on transient CLI errors, provider-call retries in the VM engine, crash-replay of pending ops. These are currently tested with `vi.fn()` unit mocks (406 uses) rather than through running runtimes.

**Proposal.**

```typescript
.with(spyOn(HetznerProvider).createServer
    .override(async (input, callReal, n) => n === 0 ? new PROVIDER_TIMEOUT() : callReal(input))
    .times(2))
```

- `n` = zero-based call index for this interceptor.
- Returning an error instance throws it to the caller — for HTTP, events **and** `@mockable` (see below).
- `callReal` is only available in spy (pass-through) mode.

**Related fix.** `mockOf(Svc).m.andReturn(new ERR())` on `@mockable` most likely returns the error object as a plain value instead of throwing it (the value crosses JSON IPC and is returned as-is: `GGMockableCall.ts:23-37`, `GGMockableInterceptorsServer.ts:36`). Confirm with a test; fix alongside. Kratt has zero such usages today, which may be because it doesn't work.

---

## 6. Negative expectations over a settle window: `.never()`

**Problem.** `times(0)` only covers the action window. "This must not happen within N ms after the action" — e.g. no event leaks to another tenant — needs a settle period.

**Kratt usage.** Live state fans out per org/user over sockets; asserting that a second org's socket receives nothing for a mutation in the first org is a security property, and currently only holds within the action window. Depends on item 1.

**Proposal.**

```typescript
await alice.secrets.save({...})
    .waitFor(alice.socket.mock.onWorkspaceLifecycle.toMatchObject({...}))
    .never(otherOrg.socket.mock.onWorkspaceLifecycle, {settleMs: 300});
```

---

## Parked — no current kratt need

| Idea | Why parked |
|---|---|
| HTTP status-code assertions in `.toBeError()` | Kratt's consumers are grest clients that read the body `type`; no test relies on status codes. |
| Running whole suites against deployed environments | Item 3 covers the concrete need (typed calls to a live VM); a portable-vs-grey-box suite mode is a much larger change. |
| Ordered event sequences (`expectSequence`) | No kratt test asserts event order today. Revisit after item 1. |
| Request recording & replay | No kratt workflow asks for it. |
| Per-test DB clone scope | Kratt suites isolate data per suite already (unique ids); per-test DynamoDB clones would cost table creation per test. |
| Typed DynamoDB seeding | Kratt's seeds write raw rows past its record schemas, but its tables are kratt-defined — a kratt-side fix. |

## Suggested order

1 → 2 → 3 → 5 → 4 → 6. Item 1 is a small correctness fix; 2 and 3 remove the most hand-written kratt test code; 5 unlocks runtime-level recovery tests; 4 protects independent hub/relay deploys; 6 depends on 1.
