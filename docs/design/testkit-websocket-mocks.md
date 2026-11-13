# Testkit: mocks, spies and `.on()` for WebSocket calls between runtimes (#204)

Status: **design proposal**. The owner decides before anything is built. It follows
`testkit-mock-routing-architecture.md` (HTTP, built in #199/#201).

## 1. The problem

A runtime that holds a `GGWebSocketSchema` client to another runtime can't be mocked or spied in a test:
- `Api.mock.x` / `Api.spy.x` exist only on `GGHttpSchema`. `@grest-ts/websocket/testkit` mocks only the server → client
  messages on the test's *own* socket (`callOn(Api).connect()`, then `.mock.someEvent`).
- The test router tunnels a socket upgrade as raw bytes (`SocketHandler`, `http-proxy` `ws`), and only for
  discovery clients. A client with a fixed `url` or a `beforeConnect` URL dials the server directly, with no router.
- `.on()` sits on the shared `GGMockWith`, so it shows up on socket mocks, but `checkTarget()` rejects it there.

What it costs a test today: the peer runtime has to run, its answers can't be chosen, and what was sent can only be
asserted through the peer's side effects. The workaround is the third-party one: wrap the socket client in a
`@mockable` class and `mockOf` that.

### Does kratt need it?

`grep` over kratt for socket clients in server code (`GGWebSocketSchema.createClient`, `new WebSocket(` outside UI):

| Socket | Between | Tested today |
|---|---|---|
| `TycoonRelaySocketApi` (`report`, client → server only) | relay → tycoon server | `tycoonFlow.test.ts` calls `connectTycoon` in the test process against the real `TycoonRuntime` and asserts what viewers receive. No mock wanted: the flow is about the real server. |
| `SocketApi` (socket-server `/socket`) | browser → socket-server | `callOn(SocketApi)`, the test's own socket (already covered). Hub → socket-server is `NotifyApi`, which is HTTP. |
| OpenAI Realtime (voice), CDP (remote-browser) | runtime → third party | raw `ws`, behind kratt's own classes; the `@mockable` adapter rule applies. |
| `IdeAgentApi`, terminal/desktop/log streams | VM process or browser → relay | raw sockets, not between grest runtimes. |

So kratt has one runtime-to-runtime socket and no test that wants to mock it. The issue's "no hub → relay call
uses a socket" is right; the relay → tycoon socket is the one case, and its test needs the real server.

## 2. A test, before and after

An example that doesn't come from kratt: `OrderRuntime` holds a `PricingFeedApi` socket to `PricingRuntime`
(`clientToServer.quote`, `serverToClient.priceChanged`).

**Before (today)**
```ts
const t = GGTest.startWorker({orders: OrderRuntime, pricing: PricingRuntime})
// The real pricing runtime answers, and what orders sent isn't visible. To choose the answer:
@mockable class PricingFeed { quote = async (sku: string) => this.client.outgoing.quote({sku}) }   // production seam
await alice.orders.place({sku: "A1"})
    .with(mockOf(PricingFeed).quote.toEqual("A1").andReturn({price: 42}))
    .toMatchObject({price: 42})
```

**After (option B, recommended)**
```ts
const t = GGTest.startWorker({orders: OrderRuntime, pricing: [PricingRuntime, PricingRuntime]})
await alice.orders.place({sku: "A1"})
    .with(PricingFeedApi.mock.quote.toMatchObject({sku: "A1"}).andReturn({price: 42}))
    .toMatchObject({price: 42})
await alice.orders.place({sku: "A1"})
    .with(PricingFeedApi.spy.quote.on(t.pricing[1]).responseToMatchObject({price: expect.any(Number)}))
// A push from the server side, on the one connection orders holds to pricing[0]:
await alice.orders.cart()
    .with(PricingFeedApi.push.priceChanged({sku: "A1", price: 40}).on(t.pricing[0]))
    .toMatchObject({total: 40})
```
No production seam. The mock, spy and `.on()` read like their HTTP versions, and `.on()` names the connection by the
runtime (or `GGTest.target(address)`) at its other end.

## 3. Options

### A. Intercept in the client
In a test scope the runtime's `GGSocket` asks the runner over IPC before each outgoing `REQ`/`MSG`, the way
`@mockable` calls do. The runner's interceptor table answers (mock) or lets it go (spy reports both sides).
- **+** No protocol work in the router; the client knows its destination, so `.on()` is easy.
- **−** The connection itself stays real: a mock for a server that isn't running can't connect at all, unless the
  handshake is faked in the client too.
- **−** A second interception path next to the HTTP router. This is the "spies reported by the client" design that
  #201 rejected (`testkit-mock-routing-architecture.md` §1).
- **−** Pushes (server → client) would need the server side instrumented as well.

### B. The router terminates the socket and speaks the protocol (recommended)
The HTTP flow, per message:
```
client ──WS upgrade──> test router: destination := x-gg-test-destination ?? discovery pick   (once, at connect)
                       handshake: forwarded to the destination; answered locally when no destination exists and
                                  every interceptor on the API is a mock
                       each frame client → server (REQ/MSG): interceptor := table.match("Api.method", destination)
                         mock → router answers RES        spy/none → forwarded, the spy sees REQ and its RES
                       each frame server → client: passed through; `Api.push.m(...)` sends one into the connection
```
- One table, one precedence rule (targeted > untargeted > real > 404), the same `.on()` targets and "went to"
  reporting as HTTP. A connection's destination is fixed at connect, so per-message matching is a map lookup.
- Addressed clients (`url`, `beforeConnect`) go through the router the way #201 sends HTTP: a test-mode connector
  carries the destination in one upgrade header. TLS destinations dial with the carried settings (pin, CA, client
  cert); discovery `wss` targets work since #198/#208.
- **−** The router must decode and re-encode frames for schema sockets (`MessageType`, ids, the `HANDSHAKE` headers).
  The framing is already shared code in `@grest-ts/websocket`; the router imports it from the websocket testkit.
- **−** A buffering point per frame, so the cost is latency in tests only. Raw sockets stay byte tunnels.
- Size: about +350 framework lines (router socket handler, connector hook, `mock`/`spy`/`push` on
  `GGWebSocketSchema`), +300 test lines. One PR, or two if addressed clients come second, as #199/#201 did.

### C. Don't build it now
Keep the `@mockable` adapter as the workaround (the pattern in the testkit README, "Third-party services"). `.on()` on
a socket mock keeps throwing; its message already names where `.on()` works.
- **+** No framework code while no consumer needs it.
- **−** A production seam per socket client, and spies only through the adapter.

## 4. Recommendation

**C now, B when a test needs it.** kratt has one runtime-to-runtime socket, and its test wants the real server.
When a case comes up, build B: it is the HTTP model applied per message, adds no second interception path and keeps
pushes, addressed clients and `.on()` consistent with #201. A is cheaper only until it has to fake a handshake or a
push, and then it duplicates the router.

## 5. Out of scope

- Raw sockets (`GGRawWebSocketSchema`): byte streams with no method paths to match; they stay tunnelled.
- Third-party sockets (OpenAI Realtime, CDP): `@mockable` adapter, as for HTTP third parties.
- Browser sockets: the test's own socket (`callOn(Api)`) is unchanged.
- Reconnect and liveness: the router forwards `PING`/`PONG` and closes both sides together; it doesn't simulate
  drops. A test that needs a drop closes the connection through the runtime's API or stops the peer.
- `GGSocketBroadcast` fan-out inside one runtime: not a call between runtimes.

## 6. Decisions for the owner

1. C now, or build B now?
2. If B: is `Api.push.m(...).on(target)` (server → client into a runtime) wanted in the first PR, or only
   `mock`/`spy` on client → server calls?
3. If B: should addressed socket clients (`url`, `beforeConnect`) go through the router in the same PR?
