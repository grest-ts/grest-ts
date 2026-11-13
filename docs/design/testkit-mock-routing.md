# Testkit: mocks and spies that reach every call, and can target one runtime

Status: **proposal**. It fixes #174 (schema mocks miss clients that don't use discovery) and #172 (a test client
fails inside a mock callback). It also adds what multi-instance tests are missing: aiming a mock or spy at **one**
runtime with `.on(t.x)`.

The spike on branch `kratt/spike-relay-mock-routing` proves the core routing (untargeted mocks for pinned clients)
and the #172 fix. `.on()` and spies reported by the client are not spiked yet.

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

It takes one runtime selector: `t`, `t.relayA`, `t[1]`, `t.hub[1]`. Without `.on()`, an interceptor matches
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
    const wsA = relayWorkspace(t.relayA)        // kratt helper, see §4: seeds a row pointing at this relay
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
3. Nothing matches: the call proceeds exactly as in production. It goes to discovery's choice or to the given
   address, and when a test runtime listens there, that's a real call.

**"At a runtime" means:**
- **schema interceptors:** the call's destination is the runtime's server address, whether discovery picked it or
  the call was addressed explicitly. Comparing addresses (not a new instance id) means production needs nothing
  new: the caller already holds the address and the testkit already knows every test runtime's address.
- **`@mockable` interceptors:** the call runs in that runtime. Every runtime's IPC connection already carries its
  `runtimeId`.

**Spies** are reported by the client, for every client in a test runtime: the client reports the request, makes
the real call, then reports the response. It's the same as `@mockable` spies (`mockable/call` +
`mockable/spy-result`). The test process no longer proxies spied calls. That means a spy works for pinned TLS
targets and doesn't need the service to be registered in discovery.

**Failure messages** list where the method's calls in this action actually went. That's what makes a misrouted
call obvious (case 4).

## 3. How it works

```
runtime: client.method(data)
  → resolve the address as today (discovery, url, or connection settings)
  → ask the test process (IPC "http/route", the same pattern as "mockable/call"):
        {key: "POST /api/agent/deliver-peer-message", target: "https://127.0.0.2:41234"}
  ← "mock"  → send to the test router (plain HTTP, no pin) → interceptor.onRequest → returnData
  ← "spy"   → real call; report the request before it and the response after it
  ← nothing → real call
```

- **grest-ts `http/src`:** one hook in `createClient`, registered only by `@grest-ts/http/testkit` inside test
  runtimes. Production pays one `undefined` check per call.
- **grest-ts `http/testkit`:**
  - the IPC handler that answers the hook;
  - interceptors keyed by method + target instead of method only;
  - target → runtime matching, using each runtime's registered server address. Registrations need the bound host,
    not only the port, so two runtimes on `127.0.0.2:P` and `127.0.0.3:P` stay apart;
  - spies reported by the client.

  Mocks stop adding a route to discovery: the hook covers every client in a runtime. Calls the test makes itself
  (`GGTestContext`) aren't mocked, because they are the action.
- **grest-ts `testkit`:**
  - `.on()` on `GGMockWith`/`GGSpyWith`;
  - `mockable/call` matched against the calling runtime's `runtimeId`;
  - the "went to" lines in failure messages;
  - the #172 fix (§5).
- **Cost:** one IPC round trip per outbound call from a runtime under test. Clients that use discovery pay the
  same today (one per `discoverApi`). So do `@mockable` methods.

Effort: about 3 days with tests and READMEs. It can ship in two PRs:
1. Untargeted interception for every client, plus #172. This is what the spike proved; about a day. kratt's relay
   tests can be written with it right away (case 3).
2. `.on()`, client-reported spies, and "went to" messages.

## 4. What kratt needs

Production code needs no change for case 3. Cases 4 to 9 need real relays in tests:
- **The relay's listen host and port become config,** with production defaults `0.0.0.0` and `9600`. The hub
  dials the same port setting. Today both are the constant `RELAY_PORT`. It's normal config, per the grest-ts rule
  "never hardcode ports", not a test seam.
- **A test helper in kratt's bag** that runs each relay on its own loopback IP with a free port and seeds a row
  pointing at it. Config updates made in the describe body become the runtime's start config, so it can set the
  address before the relay starts:

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

## 5. #172: test clients inside mock callbacks

**Cause:** `IPCServer` captures the locator scope it is constructed in and re-enters it for every request. The
testkit's vitest setup constructs it in the root scope (`GGTestRoot`), while `GG_DISCOVERY` is set one level down,
on the describe block. So every mock callback runs where discovery can't be found.

**Fix:** in `GGCallInterceptor` (shared by schema and `@mockable` interceptors), capture the scope at `register()`
and run the `andReturn` callback in it. That scope is the test's own branch, with discovery, the runner and
anything the test set. It's about 10 lines and was verified in the spike.

## 6. Alternatives considered

| Option | Why not |
|---|---|
| A testkit hook per connection key (`GGTest.with(GG_RELAY_CONN)...`) | It's the same routing plus an opt-in step, it covers less (fixed-URL clients aren't included), and it makes a src class aware of tests. |
| kratt-only: configurable port + a stand-in relay | The relay clients never ask discovery, so mocks still wouldn't fire, and tests would fall back to hand-built fakes. |
| A new instance id on every runtime | Callers don't have it without a new report-in flow that production doesn't need, and it changes on restart. The address is the identity callers already hold. |
| Selector-first API (`t.relayA.mock(Api).m`) | A mock belongs to its contract or class; the runtime only narrows it. Selectors suit what only exists per runtime (logs, config, jobs). It would also add four more ways in that do the same as `Api.mock` and `mockOf`. |
| Per-instance routes in discovery | A production change in two repos for a test need. |
| Pushing the active interceptors to runtimes instead of asking per call | Kept as an optimization if the round trip shows in timings. It doesn't change the API. |

## 7. Open questions

1. **Name:** `.on(t.relayA)` or `.at(t.relayA)`?
2. **Custom `transport` clients:** should an active mock bypass the transport? The proposal says yes, because the
   mock is on the contract. Only spies would still go through the transport.
3. **WebSocket schemas:** the same model fits `GGWebSocketSchema` clients. Should that wait until a case appears?
4. **Ship order:** part 1 (untargeted + #172) first, so kratt can start, then part 2?
