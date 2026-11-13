# Testkit: mocks and spies that reach every call, and can target one runtime

Status: **proposal**. It fixes #174 (schema mocks miss clients that don't use discovery) and #172 (a test client
fails inside a mock callback). It also adds what multi-instance tests are missing: aiming a mock or spy at **one**
runtime with `.on(t.x)`.

The spike on branch `kratt/spike-relay-mock-routing` proves the core routing (untargeted mocks for pinned clients)
and the #172 fix; an independent review re-ran it in worker and inline mode. `.on()` and spies reported by the
client are not spiked yet.

**Decided:** see §9.

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

**Exactly one interceptor handles a call.** For each call, the active interceptors of its method are checked:
1. A targeted interceptor matches only calls at its target. An untargeted one matches calls at any target.
2. If both match, the targeted one wins. An untargeted `spy.m.times(0)` next to a targeted mock therefore does
   **not** see the targeted call.
3. Two interceptors with the same method and the same target (or both untargeted) is a setup error and throws on
   registration. Today HTTP only throws by accident (find-my-way), and `@mockable` silently overwrites; both get an
   explicit check.
4. Nothing matches: the call goes where it would in production. If a test runtime listens there, it's a real call.

**`.on()` accepts:**
- **a runtime selector holding exactly one runtime**, e.g. `t.relayA`, `t[1]`, `t.hub[1]`. A selector with several
  runtimes throws: `.on(t.hub)` with two hubs is ambiguous.
- **an address target, `GGTest.target("host:port")`**, for schema interceptors only. It's meant for targets with no
  test runtime, like a fake row in a fan-out test (§9). On `mockOf`/`spyOn` it throws, because a method runs in a
  runtime, not at an address.

**What "at" means:**
- **Schema interceptors match on the call's destination.**
  - The destination is `connectionSettings.host:port` when set (port defaults to 443, as the node transport
    does), otherwise the origin of `config.url`, otherwise the instance discovery picked.
  - A client with `url: ""` and a custom transport and no host has no destination, so only untargeted
    interceptors match it.
  - A runtime target matches when the destination is one of that runtime's HTTP server addresses (see "Runtime
    addresses" in §3).
  - Address matching treats `localhost`, `127.0.0.1` and `::1` as equal. A server bound to all interfaces
    (`0.0.0.0`, the `GGHttpServer` default) matches any host on its port.
  - A destination that matches two runtimes throws, instead of picking one.
- **`@mockable` interceptors match on the runtime the method runs in,** via the `runtimeId` every runtime's IPC
  message already carries (`SocketMessage.runtimeId`).

**Opt-in per interceptor kind.** `.on()` lives on the shared `GGMockWith`/`GGSpyWith`, but only HTTP and
`@mockable` interceptors support it. Every other kind throws if a target is set, e.g. WebSocket messages (§7) and
events (`GGEventsInterceptor`). The throw is the default in `GGCallInterceptor`; a kind enables targeting
explicitly.

**Failure messages** list where the method's calls went during the action. The destination is shown by runtime
key (`relayB`) when it's a test runtime, or by address otherwise. That makes a misrouted call obvious (case 4).

**Limit (as with `@mockable`):** a call made from a detached async context, with no locator scope, can't reach the
test process and goes out for real.

## 3. How it works

Reviewed against the current code by a second, independent model (Fable). The design reflects its findings.

### Today

- **Discovery-routed calls already go through the test router.** Under the testkit, `GGLocalDiscoveryServer`'s
  `discoverApi` returns the router's own URL for every registered API (`GGLocalDiscoveryServer.ts:56-61`). The
  router answers from an interceptor, or proxies to the instance the API's routing strategy picks (`:74-76`).
- **A mock works by a trick with side effects** (`GGHttpInterceptorsServer.ts:118-124,182`):
  - It adds the router itself as a discovery route and switches the API to the `last` strategy.
  - Unmocked sibling methods of the same API can then be proxied to the router itself and time out.
  - Removing the mock resets the strategy to round robin, overwriting a test's own `Api.routing.first()`.
- **Spies are proxied by the router** through `forward()`. It drops the query string, the status code and the
  headers, and it pins to the instance captured when the spy registered (`:93-102,143`).
- **Clients that set their own address** (`url`, `transport`, `GG_RELAY_CONN`) never reach the router.

### After

Two paths, one per kind of client. Both follow existing protocols.

```
discovery-routed call: the router decides before reading the body
  runtime → router: resolve(method, path) → instance := selectInstance(path)   (once per call)
                                            interceptor := match(key, instance)
      mock    → read body → interceptor answers
      spy     → read body → proxy to instance → interceptor sees request + response
      nothing → lossless proxy.web to instance (as today, no body read)

client-addressed call (url / transport / connection settings): ask, answered in the reply
  runtime: testTransport wraps the real transport
      → IPC "http/call" {key, destination, input}       (same shape as mockable/call)
      ← {mock: envelope}  → return it as the Response; nothing is dialled
      ← {spy: true}       → real call; IPC "http/spy-result" {key, destination, response}
      ← {}                → real call, exactly as in production
```

**Why the mock is answered in the reply,** not by sending the call to the router:
- The router keys interception by method and path, one handler per route. Two targeted mocks on one path (case 6)
  couldn't be told apart.
- A mock removed between the ask and the HTTP request would fall through to the proxy.

It's also literally `mockable/call`: one round trip, no header, no race.

**Runtime addresses.** Each test runtime reports its HTTP server addresses (`{host, port, tls}`) after
`runtime.start()`, through the IPC channel it already uses for `registerKeys` (`GGTestRuntimeWorker.ts:105-110`).
The test process knows the sender from `msg.runtimeId`. Discovery is not changed. Extending discovery
registrations instead would mean an IPC client per runtime with its runtimeId, and that would overwrite the
worker's own entry in `SocketHandler`.

**Selector keys.** `GGTest.start*({relayA: RelayRuntime, relayB: RelayRuntime})` must give each key its own
runtime. Today both keys get both relays, because runtimes are grouped by the class's `NAME`
(`GGTestSelector.ts:170-174`). That's a bug on its own, fixed here by assigning runtimes to keys in the order given.
The key name is passed down so failure messages can say `relayB`.

### Changes per file

| Package / file | Change |
|---|---|
| `http/src/client/GGHttpSchema.createClient.ts` | `_registerTestTransport(f)` hook. For client-addressed calls (`config.url !== undefined`), wrap the transport with `f({key, url, settings, input}, transport)`. Outside tests: one `let` and one branch, browser included. |
| `http/testkit/mock/GGHttpTestRoute.ts` (new) | Registers the test transport in runtimes (`GG_TEST_RUNTIME_WORKER.tryGet()` per call, so inline runtimes and several describe blocks work). Computes the destination. Implements the ask and the spy report. No test-process branch: `GGTestContext` clients always use discovery. |
| `http/testkit/mock/GGHttpInterceptorsServer.ts` | Interceptor table keyed by key + target, with a duplicate check. Answers `http/call` and `http/spy-result`. Router resolver as above. The fake route, the strategy switch and the registration-time spy target are removed. "Went to" log per action. |
| `discovery-local` `GGLocalDiscoveryServer.ts` | `discoverApi` succeeds when the API has a route, an interceptor or a default (an `isServed` hook set by the interceptors server). `matchRoute` becomes a public `selectInstance`, picking only among real instances. |
| `testkit-vitest/src/GGTestDiscoveryClient.ts` | The same `isServed` check in `getRoutingUrl`. |
| `ipc/src/server/HttpHandler.ts` | One resolver `(method, path) → {target, handler?}` before the body is read, in place of today's route-then-proxy split. |
| `http/testkit/mock/GGHttpSchema.mock.ts` | Interceptor config carries the target. |
| `testkit/src/testers/GGMockWith.ts`, `GGSpyWith.ts` | `.on(selector | GGTestTarget)`. |
| `testkit/src/testers/GGCallInterceptor.ts` | Stores the target; throws by default when a target is set (kinds opt in). "Went to" in the "never called" error. #172: runs `andReturn` callbacks in the scope captured at `register()`. |
| `testkit/src/testers/GGTestSelector.ts` | Keys assigned in the order given; `.on()` needs exactly one runtime. |
| `testkit/src/GGTestRuntimeWorker.ts` + `GGTestRunner.ts` | Report and store server addresses per runtime. |
| `testkit/src/mockable/GGMockableInterceptorsServer.ts` | Keyed by class.method + target, matched against `msg.runtimeId`, with a duplicate check. |
| `testkit/src/GGTest.ts` | `GGTest.target(address)`. |
| tests | The nine cases of §1 as example tests (worker and inline), plus a TLS example runtime for case 5 (a pinned real call), plus regression tests for the selector-key bug, an unmocked sibling method under a mock, `routing.first()` surviving a mock, and duplicate interceptors. The existing suites are the regression net. |
| docs | testkit README (targeting section), http README (one line), grest-ts skill. |

**Estimate (the reviewer's, which I accept):** 500–600 lines of framework code, 500–700 lines of tests,
**6–8 days**. My first estimate (~300 lines, 3 days) missed the selector bug, the routing side effects, the
address reporting and the lossless router path.

**Order inside the one PR:** the first commit is untargeted interception, #172 and the routing side-effect fix.
That part is proven by the spike and unblocks every kratt item in §4. Targeting follows in later commits, so the
first part can be reviewed or reverted on its own.

### Details the build must get right

1. **One instance choice per call.** Round-robin counters are per path (`RoundRobinStrategy.ts:12-15`), so the
   resolver calls `selectInstance` exactly once and uses the result for both the match and the proxy.
2. **Spy error responses.** `parseContractResponse` checks `instanceof ERROR`
   (`testkit/utils/validateContractResponse.ts:11`), so a raw `{success: false, type, data}` envelope may never
   satisfy `spy.toBeError(X)`, on either path. Add a test, and parse the envelope into an `ERROR` first if it
   fails.
3. **GET/DELETE input.** Router mocks see no input for GET/DELETE today, because the query string is dropped
   (`HttpHandler.ts:48,64`). The ask path sends the real input. Fix the router side as well, so both paths see the
   same input.
4. **Fake targets fail fast.** Seed loopback addresses (connection refused), not `10.x` ones (hangs until timeout).
5. **Isolated runner.** The address report and the test transport must work there too. Verified for worker and
   inline only.

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
6. Mocks on client-addressed calls are answered in the reply to the ask (`http/call`), like `mockable/call`. The
   call is not sent to the router.
7. Test runtimes report their own server addresses; discovery registrations stay as they are.
8. One PR. The first commit is untargeted interception, #172 and the routing side-effect fix; targeting follows.
9. The selector-key bug is fixed (each key gets its own runtime), rather than the examples being rewritten to
   `t.relay[0]`.
