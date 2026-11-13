# Testkit targeting: architecture note (gate 1)

Status: **for approval, no code written.** Intent: `testkit-mock-routing.md` §1–§2 on `kratt/design-relay-mock-routing`.
Every claim about today's code was read on `dev`.

## 1. The flow

```
client ──HTTP──> test router ── resolve(req), before the body is read ──────────────────────────
                   candidates  := interceptor table . find(method, path)        find-my-way templates
                   destination := x-gg-test-destination header (PR 2)
                                  ?? discovery.selectInstance(path)             lazy, at most once
                   interceptor := candidate targeted at destination ?? untargeted candidate
                     mock    → read body → interceptor answers
                     spy     → read body → forward(destination) → interceptor sees request + response
                     nothing → forward(destination); no destination → default answer, else 404
```

It is one flow because the router is the only place that matches, answers, observes and forwards. A client never
asks anything and never reports anything. The two kinds of client differ in one value: who names the destination.
- **Discovery client (PR 1):** unchanged. It already sends to the router, and the router picks the instance.
- **Addressed client (PR 2):** `url` or connection settings. In test mode its default transport sends the same
  request to the router with the destination (origin plus connection settings) in one header.

`forward` is `proxy.web` (streaming, as today) when nothing intercepts a discovery call. It is one buffered
function for spies and for header destinations: raw body, query string, status and headers pass through unchanged.

The instance is selected only when a targeted candidate, a spy or no candidate needs it. An untargeted mock
answers without advancing round robin.

Rejected:
- Intent §3 (IPC ask for addressed clients): two paths, and spies reported by the client.
- Router answers "dial it yourself" when nothing matches: the wire stays real, but spies again need client reports.
- Interception in the receiving server: can't mock a target that has no runtime.
- A runtimeId on the discovery IPC client: it replaces the worker's entry in `SocketHandler.clientsByRuntimeId`.
- A `createClient` hook that rewrites the base URL: more production lines than the existing transport seam.

## 2. The two PRs

### PR 1: targeting inside the discovery flow

| File | Adds | Deletes |
|---|---|---|
| `ipc` `HttpHandler.ts`, `IPCServer.ts` | `setHttpResolver(req → base URL \| handler(req, res) \| undefined)` | `interceptHttp`, `removeInterceptHttp`, find-my-way, `readJsonBody`, the 200-only JSON reply (~55 lines) |
| `http/testkit` `GGHttpInterceptorsServer.ts` | the resolver above, the buffered `forward`, the "went to" record | the fake discovery route, `last`/`roundRobin` switching, `mockRoutedApis`, `routeToDefault`, `runningService`, the lossy `forward`, the spy pinned at registration |
| `http/testkit` (new, ~25 lines) | worker reports each `GGHttpServer`'s `{host, port}` after start | |
| `testkit` `GGInterceptorTable.ts` (new, ~40 lines) | key → targeted + untargeted, explicit duplicate throw, `match(key, at)` | the plain `Map` in both interceptor servers |
| `testkit` `GGCallInterceptor.ts` | `target`, `checkTarget()` (throws by default) called in `register()`, scope captured at `register()` for callbacks (#172), "went to" in the never-called error | |
| `testkit` `GGMockWith.ts`, `GGSpyWith.ts` | `.on(selector)` | |
| `testkit` `GGTestSelector.ts`, `GGTestRuntime.ts` | keys take runtimes in the order given, runtime `label` (`relayB`, `hub[1]`) | grouping by `NAME`; deprecated `createRuntimeSelector` if unused |
| `testkit` `GGTestRuntimeWorker.ts` | `onRuntimeStarted` hook (~8 lines) | |
| `testkit` `GGMockableInterceptorsServer.ts` | match on `msg.runtimeId` through the table | commented-out throws |
| `discovery-local` `GGLocalDiscoveryServer.ts` | `isServed` predicate in `discoverApi`/`getRoutingUrl`, public `selectInstance` | private `matchRoute` |
| `http` `GGHttpServer.ts` | `host` getter | |

**Production code:** `createClient` 0 lines, browser bundle untouched. Node-only: `GGHttpServer.host` (+3),
discovery-local (about +8), ipc (net about −35).

### PR 2: custom addressing

| File | Adds | Deletes |
|---|---|---|
| `http/testkit` `GGHttpTestTransport.ts` (new, ~40 lines) | replaces the node default transport through the existing `_registerNodeDefaultTransport`. A URL that already points at the router passes through. Otherwise it sends to the router with the destination header. Outside a test scope it calls the real transport. | |
| `GGHttpInterceptorsServer.ts` | header → destination; `forward` dials with the real `nodeDefaultTransport` and the carried settings; specific-host and ambiguity rules | |
| `testkit` `GGTest.ts` | `GGTest.target("host:port")` | |
| `ipc` `IPCServer.ts` | larger `maxHeaderSize` (1 line) | |

**Production code:** 0 lines planned. If module load order proves fragile, the fallback is an explicit
`_registerTestTransport` in `createClient` (≤6 lines, one `let` and one optional call). PR 2 deletes nothing: it is
purely the cost of custom addressing.

## 3. The nine cases

1. **Service calls service.** Untargeted mock is the only candidate, so it answers with no instance selected.
2. **Fixed URL (PR 2).** Test transport sends to the router with `https://api.github.com` as destination; the mock answers.
3. **Pinned target, any address (PR 2).** Destination is `settings.host:port`; the untargeted mock answers before any dial.
4. **Misroute.** Mock is `.on(relayA)` and the call's destination is relayB: no match, forwarded to real relayB,
   recorded. The mock fails with "went to: relayB (1)". PR 1 proves it with replicas, PR 2 with addresses.
5. **Spy on a real TLS relay (PR 2).** Router reads the body, dials relayA with the hub's pin, and the spy sees
   both sides. The response goes back with its status and headers.
6. **Fan-out.** Two candidates on one template with different targets; each call matches by its destination.
7. **One fails.** Targeted mock answers `SERVER_ERROR` for A; the targeted spy forwards B.
8. **Replicas, `@mockable`.** The same table, matched on `msg.runtimeId` of the `mockable/call` message.
9. **Callback in a mock (#172).** `andReturn` runs in the scope captured at `register()`, where `GG_DISCOVERY` is set.

## 4. Pitfalls

- **B1.** `createObjectResult` walks the keys and takes each key's runtimes from the list in order (same order as
  `extractConstructors`). `.on()` throws unless the selector holds one runtime. The key becomes the runtime label.
- **B2.** No fake route and no strategy change exist any more. A sibling method has no candidate and is forwarded
  to a real instance. A test's `Api.routing.first()` is never touched.
- **N1.** A default is a table entry of lowest precedence: targeted > untargeted > real instance > default > 404.
  `discoverApi` succeeds through `isServed`, not through a route.
- **H1/N3/N4.** The worker reports `{host, port}` over its own IPC client, which already carries the runtimeId.
  Discovery is unchanged. An entry counts only while its `GGTestRuntime` is running, is replaced on restart and is
  dropped in `onClientDisconnect`. Discovery saying `http` for TLS servers stays as it is (not addressed here).
- **N2.** PR 1 destinations are always `localhost:<port>`: match on port, loopback host against a wildcard or
  loopback bind. PR 2 adds: a wildcard bind matches loopback hosts only, a specific bind wins, two matches throw.
- **H3/N5.** Decision before the body; find-my-way stays, now in the testkit table. The WebSocket upgrade keeps
  its own `setRouteProxyResolver`. One `selectInstance` per call, shared by match and forward. Spies use the
  buffered `forward`, with `redirect: "manual"`.
- **M1/N6.** `checkTarget()` throws in the base class, so events and WebSocket interceptors throw with no code of
  their own. HTTP accepts a runtime (PR 2: or an address); `@mockable` accepts a runtime only.
- **M2.** `GGInterceptorTable.add` throws for the same key and target, for both kinds.
- **M3.** Today a spy gets the raw envelope and `parseContractResponse` rejects an error envelope as "invalid
  format". `GGHttpInterceptor.parseResponseData` will build the `ERROR` first. Covered by a test.
- **N7.** Not fixed; follow-up issue.
- **N8.** No longer applies: HTTP interception uses no IPC request. Only the client's own timeout bounds `.sleep()`.

## 5. Estimate and risks

| | Framework | Tests | Days |
|---|---|---|---|
| PR 1 | about +330 / −160 | 350–450 | 4–5 |
| PR 2 | about +130 / −5 | about 300 (TLS example runtime included) | 3 |

Risks:
- **The router rewrite touches every existing mock test.** The examples suite is the regression net; I run it
  before each push.
- **Load order of the transport override (PR 2).** `createClient` captures the default transport when the client is
  created. Testkits load before runtime modules in worker and inline mode by my reading; isolated mode is unverified.
- **Header size (PR 2).** CA and client-cert PEMs travel in a header; needs the raised limit and a test.
- **Buffered forwarding (PR 2).** A streamed response from an addressed client arrives whole.
- **Enumerating `GGHttpServer` instances in a runtime scope** (`getKeys` + `instanceof`) is untried.

## 6. Changes to the intent's UX, and decisions

Proposed changes to §1/§2:
- **Custom `transport` clients are outside interception.** The router can't run a client's transport, and bypassing
  it for mocks only would be the second path. This replaces intent decision 2.
- **Case 5 is "really dialled with the real pin code", not "not proxied".** The router process dials, using the same
  `nodeDefaultTransport`. The hub process itself no longer opens the TLS connection in tests.
- **`GGTest.target()` and address matching arrive in PR 2.** PR 1's `.on()` takes a runtime only.

### Needs your decision

1. Custom `transport` clients excluded (use connection settings or `@mockable`). kratt's relay clients use
   connection settings, so they are covered. OK?
2. In tests every addressed call goes through the router, unmocked third-party calls included: one more hop, and the
   TLS dial is made by the test process. OK?
3. Test hook by re-registering the node default transport (0 production lines), with the explicit `createClient`
   hook (≤6 lines) only as fallback. OK?
4. Default precedence: a running service beats `addDefault` (today's documented behaviour), mocks beat both. OK?
5. N7 (GET/DELETE mock input) and discovery's `http` for TLS servers stay out, as follow-up issues. OK?
