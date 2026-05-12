# Known test-framework flakiness

Concrete reproductions of races and timing issues in `@grest-ts/testkit`
that have been observed in downstream projects. The framework changes
needed to fix each one are scoped at the bottom of each entry — but the
fix is the framework's job, not the downstream project's. Workarounds
in user-land tests should be avoided.

---

## 1. `.waitFor` s2c interceptor unregisters before the wait

**Surfaces as:** under full-suite load, a WS server-to-client assertion
sporadically fails with

```
[Test Failed] Timeout waiting for interceptor after 5000ms
```

…even though the server-push DID arrive — earlier in the log you'll find a
matching

```
[GGSocket] GGTestError: Error: Unexpected socket message received: <Schema>.<method>
  Expected: -
  Received: Called
```

from the testkit's `unknownMessageHandler`. The message arrived; the
interceptor wasn't there to receive it.

### Where the race is

`GGTestAction.execute()` in
`packages/testkit/src/testers/GGTestAction.ts`:

```ts
try {
    await Promise.all(this.interceptors.map(i => i.register()));   // (A) register
    rawResult = await this.executeAction()                          // (B) run RPC
    await new Promise(resolve => setTimeout(resolve, 25));          // (C) 25 ms grace
} finally {
    await Promise.all(this.interceptors.map(i => i.unregister())); // (D) unregister
}
// ...
if (this._waitForInterceptors.length > 0) {
    await this._waitForAllInterceptors();                          // (E) just polls isCalled()
}
```

`.waitFor`-tagged interceptors are unregistered at (D) — the same place
`.with` interceptors are — after only **25 ms**. `_waitForAllInterceptors`
in the same file only polls `interceptor.isCalled()`; it does not keep the
underlying socket handler alive.

So the effective wait window for a server-push to be captured is
`(action_duration) + 25 ms`, regardless of the `timeout` passed to
`.waitFor`. Anything later hits `unknownMessageHandler` because the handler
is already gone, and the polling loop ticks until the 5 s timeout because
`isCalled()` stays false forever.

`.with` has the same race plus immediate validation, so it fails strictly
more often than `.waitFor`. Tested in kratt:
- `.waitFor`: 5/5 isolation pass, ~1% failure under full-suite load
- `.with`:    4/5 isolation pass, much worse under load

### Reproduction

In kratt's hub-server suite:

```bash
cd /workspace/kratt
mcp__kratt__run_tests { repo: "kratt" }
```

When the worker for `requestInit.test.ts` happens to share CPU with the
WS-heavy `taskFlow.test.ts` and others, the
`requestInit publishes a kind: init event…` test (in
`packages/hub-server/test/integration-testkit/requestInit.test.ts`)
intermittently fails. The test does:

```ts
await admin.socket.requestInit({kind: "taskLifecycle", taskId: TASK_ID}).waitFor(
    admin.socket.mock.onTaskLifecycle.toMatchObject({/* ... */}),
    5_000,
)
```

`requestInit` returns OK quickly; hub's `RequestInitService` then publishes
`onTaskLifecycle` *fire-and-forget* through the in-process pubsub. Under
load that publish's microtask can land >25 ms after the RPC response, after
(D) has already unregistered the handler.

### Framework fix (scope sketch — don't do this in user tests)

`_waitForAllInterceptors` should keep `.waitFor`-tagged interceptors
registered until the wait resolves or times out. Either:

- Split the unregister at (D) into "unregister non-waitFor" + "unregister
  waitFor (deferred)" — non-waitFor ones still tear down in the finally;
  waitFor ones get unregistered in `_waitForAllInterceptors`'s resolver and
  reject paths.
- Or change the contract so `register()` returns a handle and
  `_waitForAllInterceptors` is responsible for both the wait and the
  eventual unregister.

The 25 ms grace can stay for non-waitFor interceptors that want the "must
have happened by now" semantics.

Two side-effects worth keeping in mind:
1. `unknownMessageHandler` would no longer fire for slow-but-expected
   messages — the test's "you forgot to mock this" guard rail wouldn't
   surface as a false positive during the wait window.
2. Tests with multiple `.waitFor` interceptors registered for different
   timeouts would each get torn down independently as they fire / time out.

### Workaround for downstream projects

None recommended. The test as written is correct. Accept the rare flake
until the framework fix lands; `vitest`'s `test.retry(N)` is the obvious
band-aid but it masks the real issue and shouldn't go into project tests
"because the framework is broken."
