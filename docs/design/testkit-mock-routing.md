# Testkit: mocks and spies that reach every call, and can target one runtime

Status: **proposal**. It fixes #174 (schema mocks miss clients that don't use discovery) and #172 (a test client
fails inside a mock callback). It also adds what multi-instance tests are missing: aiming a mock or spy at **one**
runtime with `.on(t.x)`.

The spike on branch `kratt/spike-relay-mock-routing` proves the core routing (untargeted mocks for pinned clients)
and the #172 fix. `.on()` and spies reported by the client are not spiked yet.

**Decided:**
- the name is `.on()`;
- an active mock bypasses a client's custom `transport` (spies still go through it);
- everything ships as one PR.

WebSocket schemas are out of scope (§7). The full decision list is in §9.

## 1. What a test looks like

### The new API in one table

| | any runtime (as today) | one runtime (new) |
|---|---|---|
| schema mock | `Api.mock.m.andReturn(x)` | `Api.mock.m.on(t.relayA).andReturn(x)` |
| schema spy | `Api.spy.m.toMatchObject(y)` | `Api.spy.m.on(t.relayB).toMatchObject(y)` |
| `@mockable` mock | `mockOf(S).m.andReturn(x)` | `mockOf(S).m.on(t.hub[1]).andReturn(x)` |
| `@mockable` spy | `spyOn(S).m.toMatchObject(y)` | `spyOn(S).m.on(t.hub[1]).toMatchObject(y)` |

`.on(runtime)` is a modifier like `.times()` or `.sleep()`. It means "only when it happens **at** this runtime":
- for a schema mock or spy, the call is going to that runtime;
- for `mockOf` or `spyOn`, the method runs inside that runtime.

It takes one runtime selector (`t`, `t.relayA`, `t[1]`, `t.hub[1]`) or, for schema interceptors, an address target
(`GGTest.target("127.0.0.2:41234")`, §9). Without `.on()`, an interceptor matches
everywhere, exactly as today.

Two other changes make interceptors behave the same however a call is addressed:
- **A mock or spy reaches every call to its method**, whether the client found the target through discovery, a
  fixed `url`, a `transport`, or connection settings (a pinned TLS target, as in kratt's hub → relay calls).
- **A mock callback runs in the test's own context**, so it can use test clients (#172).

### Case 1: a single service calling another (unchanged)

```ts
describe("orders", () => {
    GGTest.startWorker(OrderRuntime)
    const alice = new TestContext("Alice").apis({orders: OrderApi})

    test("reserves stock", async () => {
        await alice.orders.place({sku: "A1", qty: 2})
            .with(InventoryApi.mock.reserve.toMatchObject({sku: "A1", qty: 2}).andReturn({reserved: true}))
            .toMatchObject({status: "PLACED"})
    })
})
```

### Case 2: a third-party API behind a fixed URL (works now)

```ts
// src: const github = GitHubApi.createClient({url: "https://api.github.com"})
test("opens a PR", async () => {
    await alice.repos.openPr({repo: "web", branch: "fix"})
        .with(GitHubApi.mock.createPull.toMatchObject({head: "fix"}).andReturn({number: 7}))
        .toMatchObject({prNumber: 7})
})
```

Today this mock is never called: the client has a fixed URL, so it never asks discovery. A `@mockable` wrapper is
still the right choice when the third party has its own SDK. For a contract you own, the schema mock is now
enough.

### Case 3: a call to a pinned, per-call target, any target (works now)

kratt's hub calls one VM's relay with `GG_RELAY_CONN.set({host, port, tlsPin})`. Production code doesn't change.

```ts
describe("ai-spawn", () => {
    const t = GGTest.startWorker({hub: HubRuntime})

    test("a prompt to a child is forwarded to its relay", async () => {
        await parent.aiSpawn.promptChild({workspaceId: child.id, prompt: "run the tests"})
            .with(RelayAgentApi.mock.deliverPeerMessage.toMatchObject({text: "run the tests"}).andReturn({delivered: true}))
            .toMatchObject({delivered: true})
    })
})
```

The workspace rows only need to exist; their addresses can be anything. A mock without `.on()` catches the call
before it is dialled.

### Case 4: two real relays, one mocked, and a misrouted call is caught

```ts
describe("peer messages", () => {
    const t = GGTest.startWorker({hub: HubRuntime, relayA: RelayRuntime, relayB: RelayRuntime})
    const wsA = relayWorkspace(t.relayA)        // kratt helper, see §5: seeds a row pointing at this relay
    const wsB = relayWorkspace(t.relayB)

    test("A's message reaches only A", async () => {
        await parent.aiSpawn.promptChild({workspaceId: wsA.id, prompt: "hi"})
            .with(RelayAgentApi.mock.deliverPeerMessage.on(t.relayA).andReturn({delivered: true}))
    })
})
```

If the hub sends A's message to B by mistake, A's mock doesn't fire, the call goes through to the real relayB,
and the test fails, saying where the call went:

```
[POST /api/agent/deliver-peer-message on relayA] Interceptor was never called!
  Calls to this method in this action went to: relayB (1)
```

To state it outright, add `RelayAgentApi.spy.deliverPeerMessage.on(t.relayB).times(0)`.

### Case 5: spy on a real relay (a real call, with TLS and the pin)

```ts
test("the SSH key push reaches the relay and is applied", async () => {
    await alice.sshKeys.add({publicKey: KEY})
        .waitFor(RelaySshKeysApi.spy.setAuthorizedKeys.on(t.relayA)
            .toMatchObject({keys: [KEY]})
            .responseToMatchObject({applied: 1}))
})
```

The hub really dials relayA over its pinned HTTPS. The client reports the request and the response to the test
process, and the call is not proxied, so the wire stays real.

### Case 6: fan-out, every target must be called

```ts
test("a push to main makes every workspace on the repo sync", async () => {
    await github.webhook.push({repo: "web", ref: "refs/heads/main"})
        .waitFor(
            RelayRepoEntitiesApi.mock.syncBranch.on(t.relayA).toMatchObject({branch: "main"}).andReturn(undefined),
            RelayRepoEntitiesApi.mock.syncBranch.on(t.relayB).toMatchObject({branch: "main"}).andReturn(undefined),
        )
})
```

One `.waitFor` with one targeted interceptor per relay. Each expects exactly one call (`times` defaults to 1), so a
relay synced twice fails too.

### Case 7: one target fails, the others don't

```ts
test("one unreachable relay doesn't stop the others", async () => {
    await github.webhook.push({repo: "web", ref: "refs/heads/main"})
        .waitFor(
            RelayRepoEntitiesApi.mock.syncBranch.on(t.relayA).andReturn(new SERVER_ERROR()),
            RelayRepoEntitiesApi.spy.syncBranch.on(t.relayB),          // real relayB still gets it
        )
})
```

### Case 8: replicas of one service

```ts
describe("cache invalidation", () => {
    const t = GGTest.startWorker({hub: [HubRuntime, HubRuntime]})

    test("an update on one replica reaches the other", async () => {
        await alice.settings.update({theme: "dark"})
            .waitFor(spyOn(SettingsCache).invalidate.on(t.hub[1]).toMatchObject({key: "theme"}))
    })

    test("only replica 1 fails to send mail", async () => {
        await alice.invites.send({email: "bob@x.io"})
            .with(mockOf(Mailer).send.on(t.hub[1]).andReturn(new SERVER_ERROR()))
    })
})
```

Today `MyApi.routing.first()/last()` can only switch routing for a whole API. `.on()` narrows a single interceptor.

### Case 9: a mock that calls back like the real service (#172)

```ts
const relayA = new TestContext("relayA").apis({callback: RelayCallbackApi})   // calls hub as relayA would

test("the relay acks a delivered message back to hub", async () => {
    await parent.aiSpawn.promptChild({workspaceId: wsA.id, prompt: "hi"})
        .with(RelayAgentApi.mock.deliverPeerMessage.on(t.relayA).andReturn(async () => {
            await relayA.callback.peerMessageAck({workspaceId: wsA.id})
            return {delivered: true}
        }))
    await parent.aiSpawn.childStatus({workspaceId: wsA.id}).toMatchObject({lastAck: expect.any(Number)})
})
```

Today the inner call fails with `Service "GGDiscovery" not found in async context`.

### When to target

- **One instance of each runtime:** don't target. `.on()` only adds noise.
- **Two or more instances of a runtime, or one caller choosing among targets:** target, because an untargeted mock
  also catches a call that went to the wrong instance. That's a testing convention (kratt-testing skill, grest-ts
  skill), not something the framework enforces.

## 2. Semantics

**Matching** happens per call, against the interceptors active in the current action:
1. A targeted interceptor matches only calls at its runtime. An untargeted one matches calls at any runtime.
2. If both match, the targeted one wins. Two interceptors with the same method and target is a setup error, as it
   is today.
3. Nothing matches: the call goes where it would in production. If a test runtime listens at that address, it's a
   real call.

**"At a runtime" means:**
- **schema interceptors:** the call goes to that runtime's HTTP server, whether discovery picked it or the client
  addressed it itself. The match is on the address, because production callers already hold it and the testkit
  already knows each test runtime's address. No new instance id is needed.
- **`@mockable` interceptors:** the method runs in that runtime. Each runtime's IPC message already carries its
  `runtimeId` (`SocketMessage.runtimeId`).

**Failure messages** list where the method's calls actually went during the action ("went to: relayB (1)"). That
makes a misrouted call obvious (case 4).

## 3. How it works (after reviewing the current code)

The key finding: **under the testkit, every discovery-routed call already goes through the test router.**
`GGLocalDiscoveryServer`'s `discoverApi` handler returns the router's own URL for every registered API. The router
then either answers from an interceptor (`interceptHttp`), or proxies to the instance that the API's routing
strategy picks (`setRouteProxyResolver` → `matchRoute(path)`). Spies on these calls are proxied by the router.

So there is one interception point already, the router, and the change is two narrow additions to it:

```
discovery-routed call (unchanged path)
  runtime → router → interceptor for (method, the instance the strategy picked)?  → answer   (mock)
                                                                                   → forward  (spy, as today)
                   → no interceptor                                                → forward  (as today)

call addressed by the client (url / transport / connection settings): new
  runtime: ask the router "intercepting (method, target address)?"   (one IPC round trip, like mockable/call)
     ← mock    → send to the router (plain HTTP, no pin) → interceptor answers
     ← spy     → real call to the target; report the request before it and the response after it
     ← nothing → real call, exactly as in production
```

The two additions:
- **Targeted matching in the router:** for discovery calls, the router picks the instance once per call, checks
  the interceptor against it, and forwards to that same instance if nothing matches.
- **The "ask" for client-addressed calls:** a spy on a pinned target can't be proxied, because the router would
  have to hold the pin and the client's certificates. So the client makes the real call itself and reports it.
  That is the same two-step protocol `@mockable` spies already use (`mockable/call` + `mockable/spy-result`).

### Changes per file

| Package / file | Change | Size |
|---|---|---|
| `http/src/client/GGHttpSchema.createClient.ts` | A test hook for client-addressed calls (`config.url !== undefined`): ask; on mock, send to the router with plain fetch and no connection settings; on spy, report the request and the response around the real call. `undefined` outside tests. | ~40 |
| `http/testkit/mock/GGHttpTestRoute.ts` (new) | Registers the hook. In a runtime it asks over the worker's IPC; in the test process (`GGTestContext` clients) it looks up the interceptors directly. | ~30 |
| `http/testkit/mock/GGHttpInterceptorsServer.ts` | Interceptors keyed by method + target, not method only. The router picks the instance once per call and matches against it. Answers the ask. Handles spy reports. Records "went to". | ~+90 / −20 |
| `http/testkit/mock/GGHttpSchema.mock.ts` | Interceptor config carries the target. | ~10 |
| `discovery/*` `GGServiceRegistration` + `GGLocalDiscoveryClient` | Registrations carry the bound host as well as the port (today every route is `localhost:<port>`), and the runtime's `runtimeId` under the testkit. That lets the router map an address to a runtime, and keeps two runtimes on `127.0.0.2:P` and `127.0.0.3:P` apart. | ~25 |
| `http/src/server/GGHttpServer.ts`, `GGHttpSchema.startServer.ts` | Pass the bound host into the registration. | ~5 |
| `testkit/src/testers/GGMockWith.ts`, `GGSpyWith.ts` | `.on(selector)` → `target: runtimeId`. | ~20 |
| `testkit/src/testers/GGCallInterceptor.ts` | Stores the target. Includes "went to" in the "never called" error. #172: runs `andReturn` callbacks in the scope captured at `register()`. | ~30 |
| `testkit/src/mockable/GGMockableInterceptorsServer.ts` | Keyed by class.method + target, matched against `msg.runtimeId`. | ~25 |
| tests | The nine cases of §1 as example tests in `examples/grest-test` (worker + inline), plus the existing suites as the regression net. | ~400 |
| docs | testkit README (targeting section), http README (one line), the grest-ts skill. | ~60 |

**Total:** about 300 lines of framework code across ~10 files, each change small, plus ~400 lines of tests. About
3 days. Your read that it's "quite a few changes, but the same flow" is right: nothing new runs in production,
the router stays the single place mocks answer, and the only new protocol is the ask, which copies `@mockable`'s.

### Details the build must get right

1. **Order for a mocked API with no running service.** The client asks discovery first, and discovery fails when
   the API isn't registered. Today a mock avoids this by adding a discovery route. Keep that route for an
   untargeted mock. A targeted mock always has a running runtime behind it, so it doesn't need one.
2. **Round robin.** The router must call `matchRoute` once per call. Calling it once to check the target and again
   to forward would advance the strategy twice.
3. **Spy payload shape.** The router's spies see the raw response JSON; client-reported spies must send the same
   shape (`{success, type, data}`), so `responseToMatchObject` behaves identically.
4. **Unreachable fake targets.** A row seeded with an address nobody listens on should fail fast. kratt's helper
   should seed loopback addresses (connection refused), not `10.x` ones (hangs until timeout).
5. **Inline mode.** The hook looks up the worker per call (`GG_TEST_RUNTIME_WORKER.tryGet()`), as in the spike, so
   several inline runtimes and describe blocks don't share one global.

## 4. Does it solve kratt's problems and make tests easier?

| Blocked today (kratt `TEST_QUALITY.md`) | With this |
|---|---|
| ai-spawn forwarding (`AiSpawnHubService.test`: `vi.mock` of the schema module and `setRelayTargetFor`, hand-made `vm`/`projects` fakes, 650 LOC) | A flow test through the real hub: `RelayAgentApi.mock.deliverPeerMessage.andReturn(...)` (case 3). No module mocks, no fakes for hub internals. |
| user-ssh-keys push | `RelaySshKeysApi.mock.setAuthorizedKeys` (case 3), or a spy on a real relay (case 5). |
| git webhook dispatch to relays (left as a unit test in kratt#1696) | Fan-out with one targeted mock per relay (case 6), and partial failure (case 7). |
| A relay mock that calls back into the hub (#172 workaround: write to the DB directly) | A test client inside `andReturn` (case 9). |

All four need only the untargeted part plus #172, and no kratt production change. Targeting and real relays
(cases 4–7) need kratt's relay host and port as config (§5). They are what makes misrouting and fan-out testable
at all.

To target a relay **without** running one (mock-only fan-out), `.on()` takes an address target (§9, decision 5).

## 5. What kratt needs

Cases 3 and 9 need nothing. Cases 4 to 7 need real relays in tests:
- **The relay's listen host and port become config,** with production defaults `0.0.0.0` and `9600`. The hub
  dials the same port setting. Today both are the constant `RELAY_PORT`. It's normal config, per the grest-ts rule
  "never hardcode ports", not a test seam.
- **A test helper in kratt's bag** that runs each relay on its own loopback IP and a free port, then seeds a row
  pointing at it. Config updates made in the describe body become the runtime's start config
  (`GGTestRuntime.sendCommand` queues them while the runtime is `CREATED`):

```ts
export function relayWorkspace(relay: RuntimeSelector<RelayRuntime>) {
    const host = nextLoopbackIp()                              // 127.0.0.2, 127.0.0.3, …
    relay.config.update(RelayConfig.listenHost, host)          // queued as the relay's start config
    relay.config.update(RelayConfig.port, RELAY_TEST_PORT)     // the hub's dial port gets the same value
    return seededWorkspace(async () => ({ip: host, cert: await callOn(RelayIdentity).certFingerprint()}))
}
```

The dev VM's own relay holds `0.0.0.0:9600`, so test relays can't use 9600 on any loopback address. A separate
free port avoids that. Linux routes all of `127.0.0.0/8` to loopback; macOS needs an alias per address, so
grest-ts docs should present per-host loopback as a Linux convenience, not a requirement.

## 6. #172: test clients inside mock callbacks

**Cause:** `IPCServer` captures the locator scope it is constructed in and re-enters it for every request. The
testkit's vitest setup constructs it in the root scope (`GGTestRoot`), while `GG_DISCOVERY` is set one level down,
on the describe block. So every mock callback runs where discovery can't be found.

**Fix:** in `GGCallInterceptor` (shared by schema and `@mockable` interceptors), capture the scope at `register()`
and run the `andReturn` callback in it. That scope is the test's own branch, with discovery, the runner and
anything the test set. It's about 10 lines and was verified in the spike.

## 7. WebSocket schemas (out of scope)

Decided: WebSockets are not part of this change. The reasons:
- No runtime-to-runtime WebSocket call can be mocked today. `@grest-ts/websocket/testkit` only mocks server →
  client messages on the test's own socket (`GGWebSocketSchema.callOn` → `ws.mock.someEvent`). Mocking a runtime's
  socket calls would be new work.
- A socket is a long-lived connection, so it needs its own rules (route the connection at connect time, then match
  per message).
- kratt has no hub → relay WebSocket call that uses `GG_RELAY_CONN`.

**It must fail loudly, not silently.** Socket message mocks are built with the same `GGMockWith` as HTTP mocks, so
`.on()` will show up on them. `GGSocketServerToClientInterceptor` throws when a target is set:

```ts
ws.mock.chatMessage.on(t.hub[1])
// Error: .on() is not supported for WebSocket messages yet. A socket mock already applies only to this test socket.
```

`GGWebSocketSchema` has no schema-level `.mock`/`.spy` (`WsApi.mock.x`), so that is a type error already and needs
nothing. A follow-up issue records applying this model to socket messages.

## 8. Alternatives considered

| Option | Why not |
|---|---|
| A testkit hook per connection key (`GGTest.with(GG_RELAY_CONN)...`) | It's the same routing plus an opt-in step, it covers less (fixed-URL clients aren't included), and it makes a src class aware of tests. |
| kratt-only: configurable port + a stand-in relay | The relay clients never ask discovery, so mocks still wouldn't fire, and tests would fall back to hand-built fakes. |
| A new instance id on every runtime | Callers don't have it without a new report-in flow that production doesn't need, and it changes on restart. The address is the identity callers already hold. |
| Selector-first API (`t.relayA.mock(Api).m`) | A mock belongs to its contract or class; the runtime only narrows it. Selectors suit what only exists per runtime (logs, config, jobs). |
| Route client-addressed calls through the router too (one path for everything) | The router would have to hold the client's TLS pin and certificates, and the hub's real pinned dial would no longer be exercised. Asking first keeps unmatched calls real. |
| Intercept at the receiving runtime's server | It can't mock targets that have no runtime (third parties, fake rows), so a client-side path is needed anyway. |
| Per-instance routes in discovery | A production change in two repos for a test need. |

## 9. Decisions

1. Name: `.on()`.
2. An active mock bypasses a custom `transport`; spies still go through it.
3. One PR.
4. WebSockets: out of scope, and `.on()` on a socket mock throws (§7).
5. `.on()` also takes an **address target**, for targets that have no test runtime, e.g. a fan-out test with fake
   rows. Apps wrap it in their own helpers, so tests don't hold strings:

```ts
// grest-ts
export class GGTest {
    static target(address: string): GGTestTarget          // "host:port" or a URL
}
// .on(target: Selector | GGTestTarget)

// kratt bag helper: a seeded row with a loopback address nobody listens on (fails fast if not mocked)
const wsA = await fakeRelayWorkspace()                      // {id, ip: "127.0.0.2", relay: GGTest.target("127.0.0.2:" + port)}
const wsB = await fakeRelayWorkspace()

await github.webhook.push({repo: "web", ref: "refs/heads/main"})
    .waitFor(
        RelayRepoEntitiesApi.mock.syncBranch.on(wsA.relay).andReturn(undefined),
        RelayRepoEntitiesApi.mock.syncBranch.on(wsB.relay).andReturn(undefined),
    )
```

   A target address matches calls dialled to that host and port. For a `@mockable` interceptor, `.on()` takes a
   runtime only, and a `GGTestTarget` throws, because a method runs in a runtime, not at an address.
