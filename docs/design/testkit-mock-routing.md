# Testkit: schema mocks for clients that bypass discovery (#174), mock callbacks in test scope (#172)

Status: **proposal**. Two testkit issues with a shared cause: the testkit routes mocks through discovery,
and it runs mock callbacks in the IPC server's context. Neither depends on what kratt does, but kratt's
hub → relay calls are what exposed #174.

A spike is on branch `kratt/spike-relay-mock-routing`, about 30 lines plus two throwaway tests in
`examples/grest-test`. It is a proof for this doc and not meant to be merged.

## 1. How it works today

### Pieces

| Piece | Where | Role |
|---|---|---|
| `GGConnectionSettingsKey` | `http/src/schema/GGConnectionSettingsKey.ts` | A `GGContextKey<GGConnectionSettings>` that is also a transport middleware. When it's in a schema's `use`, `createRequest()` copies its ambient value (`host`, `port`, `tlsPin`, `ca`, `clientCert`) into `fetchRequest.connectionSettings`. |
| `createClient` | `http/src/client/GGHttpSchema.createClient.ts` | Gets the base URL: `config.url` if set, otherwise `discoveryUrlResolver(apiName)`. Builds the request, merges `connectionSettings`, and calls `transport(baseUrl + path, init)`. |
| node default transport | `http/src/client/nodeConnectionTransport.node.ts` | `dialUrl()`: when `settings.host` is set, the origin becomes `https://host:port` and the base URL is ignored. A TLS setting gets a pinned undici `Agent`. |
| discovery | `discovery-local` `GGLocalDiscoveryClient.discoverApi` | One IPC round trip per call to the test process's `GGLocalDiscoveryServer`, which picks a route with the API's routing strategy. |
| schema mock | `http/testkit/mock/GGHttpInterceptorsServer.addInterceptor` | (1) Adds a discovery route `apiName → ipcServer.getUrl()` and sets the strategy to `last`, so the mock wins. (2) Calls `ipcServer.interceptHttp(method, path, handler)`. A path with no interceptor is proxied to the real service. |
| `@mockable` mock | `testkit/src/mockable/*` | It doesn't go through discovery. Every call to a `@mockable` method in a runtime sends an IPC request (`mockable/call`) to the test process, which answers with mock data or `CALL_THROUGH`. |

### Normal call (URL-less client, `MyApi.createClient()`)

```
runtime: client.method(data)
  → config.url undefined → discoveryUrlResolver("MyApi")
      → IPC discoverApi → GGLocalDiscoveryServer
          mock active? strategy "last" → http://127.0.0.1:<ipcServer>
          else                         → http://localhost:<real runtime>
  → fetch(baseUrl + "/api/my/method")
      → IPC server: interceptHttp match → mock handler → interceptor.onRequest → returnData
```

### Pinned call (kratt hub → relay)

```ts
const agentClient = RelayAgentApi.createClient({url: "", timeout})   // url "" ⇒ discovery skipped
GG_RELAY_CONN.set({host: ws.ip, port: 9600, tlsPin: {fingerprint256: ws.cert}})
await agentClient.deliverPeerMessage(...)
```

```
runtime: client.method(data)
  → config.url === "" → no discovery, so the test process never sees the call
  → createRequest: GG_RELAY_CONN.connectionSettings() → {host, port, tlsPin}
  → nodeDefaultTransport: dialUrl → https://<ws.ip>:9600/api/...; pinned Agent
      → nothing listens there (or the dev VM's own relay does) → fetch failed / "Interceptor was never called!"
```

Any client with an explicit `url` (`createClient({url: "https://api.example.com"})`) is in the same position.
Schema mocks only reach clients that ask discovery. Both kinds of client are normal grest-ts usage: a fixed URL
for a third-party API, and a per-call target (a fleet of agents, per-tenant hosts, pinned TLS) through
`GGConnectionSettingsKey`.

## 2. Options for #174

### (a) The testkit intercepts by contract, whatever the client's addressing (recommended)

**Rule:** while a schema mock is active, every call to that contract method from a runtime under test reaches the
mock, whether the client was addressed by discovery, an explicit `url`, a `transport`, or connection settings.

This follows what the testkit already does for `@mockable`, which asks the test process on every call, and for
events (`TestPublisherAdapter` sends every publish over IPC).

**What changes** (as in the spike):

1. `http/src/client/GGHttpSchema.createClient.ts`: a hook in the same style as `_registerDiscoveryUrlResolver`. It
   is only consulted for clients that bypass discovery (`config.url !== undefined`, which includes clients with a
   `transport`, where `url` defaults to `""`). If the hook returns a URL, the call goes there with plain `fetch` and
   no connection settings: the test router is plain HTTP on loopback, so a TLS pin can't apply.

   ```ts
   let testRouteResolver: ((key: string) => Promise<string | undefined>) | undefined
   export function _registerTestRouteResolver(resolver: (key: string) => Promise<string | undefined>): void {
       testRouteResolver = resolver
   }
   // in implementation(), after createRequest:
   const testRoute = config.url !== undefined && testRouteResolver
       ? await testRouteResolver(`${codec.method} ${pathPrefix}${codec.path}`)
       : undefined
   if (testRoute) baseUrl = testRoute
   const connectionSettings = testRoute ? undefined : /* existing merge */
   const wireResponse = await (testRoute ? defaultFetchTransport : transport)(baseUrl + fetchRequest.url, {...})
   ```

2. `http/testkit/mock/GGHttpTestRoute.ts` (new). Testkit extensions are loaded in every test runtime
   (`GGTestRuntimeWorker.start` → `GGExtensionDiscovery('testkit').load()`), so this registers the resolver there.
   It looks up the worker at call time, so inline runtimes and several describe blocks each reach their own test
   process:

   ```ts
   export const GGHttpTestRouteIPC = {
       mockedRoute: IPCServer.defineRequest<string, string | undefined>("http/mocked-route"),
   }
   _registerTestRouteResolver(async (key) => {
       const worker = GG_TEST_RUNTIME_WORKER.tryGet()
       return worker ? worker.ipcClient.sendFrameworkRequest(GGHttpTestRouteIPC.mockedRoute, key) : undefined
   })
   ```

3. `GGHttpInterceptorsServer` answers the request. The key is the same `"POST /api/x/method"` that `getKey()`
   already uses, so only the mocked method is diverted and the API's other methods keep their real address:

   ```ts
   this.server.onFrameworkMessage(GGHttpTestRouteIPC.mockedRoute, async (key) => {
       const interceptor = this.interceptors.get(key)
       return interceptor && !interceptor.passThrough ? this.server.getUrl() : undefined
   })
   ```

**Production code:** unchanged, in both grest-ts users and kratt. Outside tests the hook is `undefined`, so the
only cost is one `undefined` check per call. `@grest-ts/http/testkit` is only loaded by the testkit's extension
discovery, and the browser bundle never registers the hook.

**Test code before/after (kratt, ai-spawn forwarding):**

```ts
// before: a unit test that swaps the schema module and the relay target out
const relay = vi.hoisted(() => ({deliverPeerMessage: vi.fn(), setRelayTargetFor: vi.fn()}))
vi.mock("@kratt/plugin-ai-cli/vm-relay-api", async (orig) => ({...await orig<object>(), RelayAgentApi: {createClient: () => relay}}))
vi.mock("@kratt/vm-engine", async (orig) => ({...await orig<object>(), setRelayTargetFor: relay.setRelayTargetFor}))
// ... new AiSpawnHubService(fakeVm, fakeProjects, ...) ...
expect(relay.deliverPeerMessage).toHaveBeenCalledWith(expect.objectContaining({text: "hi"}))

// after (illustrative names): a flow test through the real hub. The workspace row is seeded with ip + cert, as production has.
await parentAgent.aiSpawn.promptChild({workspaceId: child, prompt: "hi"})
    .with(RelayAgentApi.mock.deliverPeerMessage.toMatchObject({text: "hi"}).andReturn({delivered: true}))
    .toMatchObject({delivered: true})

// an async push (webhook → relays) uses waitFor, as with any mock
await github.webhook.push(payload)
    .waitFor(RelayRepoEntitiesApi.mock.syncBranch.toMatchObject({repo: "web"}).andReturn(undefined))
```

**What the spike verified** (`examples/grest-test/test/zz-spike174.test.ts` on the spike branch): a runtime calls a
client created with `{url: ""}` while a `GGConnectionSettingsKey` holds `{host: 127.0.0.1, port: 1, tlsPin}`.
- With a mock active, the mock answers and `toMatchObject` on the input passes, in both `startWorker` and `startInline`.
- With no mock, the call still dials the pinned target and fails with `SERVER_ERROR` (fetch failed), as it should.
- Without the framework change, the same mock test fails with `Interceptor was never called!`.
- The full `examples/grest-test` suite (51 files, 440 tests) still passes with the change.

**Effort:** about 40 LOC in src and testkit, framework tests (pinned client, explicit-`url` client, `transport`
client, un-mocked method of a mocked API, inline + worker) and a README paragraph. About a day.

**Risk / behaviour change for other users:**
- Under test, an explicit-`url` client now hits an active mock of its API. Today it bypasses the mock silently, and
  nobody writes a mock in order to not intercept, so this fixes a surprise rather than breaking a use. Discovery
  clients behave exactly as before.
- One IPC round trip per call from a bypassing client while it runs under the testkit. Discovery clients already
  pay one per call, and so does every `@mockable` call.
- **Spies are not covered.** The test-side spy forwards to `runningService(apiName)` through discovery, and only
  the client knows a bypassing call's real target. The proposal leaves a spy on such a call un-diverted. The
  existing "never called" error then fires, with an extra line in the message: "this client bypasses discovery;
  spies need a discovery-routed client". See open question 2.

### (b) A testkit hook that resolves connection keys in tests

The test opts specific keys out of their pinned target:

```ts
describe("webhook → relay", () => {
    const t = GGTest.startWorker({hub: HubRuntime})
    GGTest.with(GG_RELAY_CONN).routeThroughTestkit()   // calls whose value comes from this key go through the test router
    test("...", async () => {
        await trigger().waitFor(RelayRepoEntitiesApi.mock.syncBranch.andReturn(undefined))
    })
})
```

**What changes:** `GGConnectionSettingsKey` gets a `[GG_TEST_RESOURCE]` (http/testkit), a command that tells
runtimes which key names are rerouted, and in `createClient` the same per-call hook as (a), but gated on "the
request's settings came from a rerouted key". A variant maps the key to a stand-in runtime instead of the test
router (`.routeTo(t.relay)`). That still needs (a)'s plumbing, plus a TLS server in the stand-in whose pin
matches the seeded rows.

**Assessment:** this is (a) plus an opt-in step, and it covers less. It doesn't help explicit-`url` clients. It
adds test awareness to a src class that currently has none. Forgetting the line gives the same silent "never
called" (a) removes. The only thing it saves is the round trip for clients that didn't opt in. 1–2 days.

### (c) kratt-side only: configurable relay port + stand-in relay runtime

```ts
// vm-config: RELAY_PORT becomes a setting for the hub's dialing side
export const RelayDial = {port: new GGSetting("relay.dialPort", IsNumber, 9600)}
// relayTarget.ts
GG_RELAY_CONN.set({host: target.host, port: RelayDial.port.get(), tlsPin: {fingerprint256: target.certFingerprint}})

// test: a stand-in relay runtime on a free port, its TLS fingerprint seeded into the workspace row
const t = GGTest.startWorker({hub: HubRuntime, relay: StandInRelayRuntime})
await t.hub.config.update(RelayDial.port, t.relay.port)   // a port the testkit exposes, which it doesn't today
await seedWorkspace({ip: "127.0.0.1", cert: t.relay.certFingerprint})
await trigger().waitFor(mockOf(StandInRelaySink).syncBranch.toMatchObject({repo: "web"}))
```

**Does it fit the framework as it is?** Only partly, and it doesn't deliver what is asked for.
- The hub's relay clients use `{url: ""}` plus a host override, so they never ask discovery. A stand-in that
  registers with discovery still doesn't make `RelayXApi.mock` fire. Tests could only assert through
  `@mockable` sinks written inside the stand-in, which are the hand-built fakes the testkit is meant to replace
  (kratt `TEST_QUALITY.md`, kratt-testing rule 1).
- It needs a TLS listener on a per-test free port, and a cert whose fingerprint is seeded into rows. The testkit
  has no API to read a runtime's bound port into another runtime's config before the first call.
- A production setting that exists only for tests is a test seam in production config. `RELAY_PORT` is also used
  for firewall rules, the proxy and agent URLs, so the setting would cover only one of its uses.
- Effort: 2–4 days in kratt, plus a stand-in that has to keep up with every relay schema.

**Not recommended.** The trivial kratt-side alternative the principle asks for doesn't exist here. kratt can't drop
the per-call target, because a fleet of pinned VMs is what discovery can't express.

### (d) Other options considered

- **(d1) Push instead of pull.** The test process pushes the set of mocked keys to every runtime on
  register/unregister, so bypassing clients check a local set with no round trip. `register()` would become a
  broadcast that must finish before the action runs. It's more moving parts and a race for in-test runtimes.
  This is worth doing later as an optimization of (a) if the round trip shows up in timings. It doesn't change
  the API.
- **(d2) Divert in the transport by path, not in `createClient`.** A testkit-wrapped node transport asks whether a
  path is intercepted. It doesn't know the contract (wrong layer: `GGHttpTransport` is just a URL plus an init
  bag), and it misses custom transports. Worse than (a).
- **(d3) Discovery learns per-target addressing** (`discoverApi(apiName, targetId)`), and kratt moves relay
  addressing into discovery. It's a large production change in both repos for a test problem. Rejected.
- **(d4) Make the IPC server an HTTPS forward proxy** that pinned calls dial. The pin check would fail against its
  cert, and so would the address. Rejected.

## 3. Recommendation

**(a).** It is the smallest change that makes the existing promise true ("mock or spy communication between
runtimes"; mocks are declared on the schema, not on an address), and it uses the mechanism `@mockable` and events
already use. Production code is unchanged everywhere, and no app needs to opt in. kratt's 37 `GG_RELAY_CONN`
schemas become mockable without edits.

Ship it with the #172 fix (below) in one testkit PR, as two commits. After it merges, kratt can drop the #174 line
from the kratt-testing skill and move ai-spawn forwarding, the user-ssh-keys push and webhook → relay dispatch to
flow tests.

## 4. #172: test client inside a mock callback

**Cause** (reproduced on `dev`): `IPCServer` captures `GGLocator.getScope()` when it is constructed, and every
request handler re-enters that scope (`this.scope.ensureEntered()`). The testkit-vitest setup constructs the
server in the root scope (`GGTestRoot`), but `GG_DISCOVERY` is set one level down, on the describe-block branch.
So any `mockable/call` handler, and any HTTP mock handler, runs user callbacks where discovery can't be found.
`bob.sites.setAccess(...)` inside `andReturn(() => ...)` then fails with `Service "GGDiscovery" not found`.

**Fix:** run a mock's callback in the scope the mock was registered from: the test's own branch, which has
`GG_DISCOVERY`, the runner and anything the test set. That is `GGCallInterceptor`, the shared base of HTTP and
`@mockable` interceptors:

```ts
// GGCallInterceptor
private scope: GGLocatorScope | undefined
public register(): void {
    // ...
    this.scope = GGLocator.tryGetScope()
    this.doRegister()
}
// onRequest, mock branch
if (typeof this.returnData !== "function") return this.returnData
return this.scope ? this.scope.run(() => this.returnData(transformed)) : this.returnData(transformed)
```

Test code needs no change: the repro in the issue just works. Verified in `zz-spike172.test.ts`: a worker-mode
`mockOf(WeatherService).getWeather.andReturn(async () => { await bob.chain.quickWeatherCheck(...) })` fails on
`dev` with the exact error from the issue and passes with the fix.

The alternative is to construct the `IPCServer` inside the describe-block scope in `testkit-vitest`. That fixes
discovery, but the callback would still miss anything set on the test's own branch, so the interceptor-level fix
is the more precise one.

**Does it fall out of the same work?** No. It's independent, and the change is in `testkit` rather than
`http/testkit`. It pairs naturally with (a), though: a relay mock that answers by calling back into hub through a
test client (`andReturn(() => agent.callback(...))`) needs both. About 10 LOC plus a regression test, an hour.

## 5. Open questions

1. **Custom-`transport` clients:** should an active mock override them too? The proposal says yes, because the mock
   is declared on the contract and a transport is just addressing plus wire. In kratt these are browser-side
   (`relayClientFactory`), so the case doesn't arise there, but another user's signing proxy transport would be
   skipped while mocked.
2. **Spies on bypassing clients:** is "not supported, clear error" enough for now? Full support would be a
   client-side spy: the client reports request and response over IPC, like `mockable/spy-result`.
3. **WebSocket schemas:** `GGWebSocketSchema` clients have the same addressing question. Leave them out until a
   case appears?
4. **Round trip vs push (d1):** start with pull (simplest, matches `@mockable`) and measure?
