# WebSocket connection pooling via extendable schemas

> Built on the unified post-#76/#77 model (now in `dev`): schemas are
> **object-config constructors** (`new GGHttpSchema({...})`,
> `new GGWebSocketSchema({contract, path, use})`); both register on one `GGHttp`
> instance (`.http()` / `.ws()` / `.wsRaw()`); `use` carries the same
> `GGTransportMiddleware`/wire mechanism for HTTP and WS, merged with
> `GGHttp.use(...)` ambient middleware. Server-side handshake setup is shared via
> `prepareSocketServer.ts`. The new `Extendable` variants follow the same
> object-config + `GGHttp` registration surface.

## Goal

Let several modules contribute methods to one WebSocket connection without a
central file listing them, and without each module restating the connection
details. A connection is declared **once** (path, `connect`, `use`); modules
`extend` it from their own files; everything that traces back to the same base
multiplexes over **one physical socket** (one per `http.Server`, one per group on
the client). Change a module's base and it cleanly moves to its own connection.

Scope: **grest-ts schema sockets only** (`GGSocket` / typed message layer). Raw
(`.wsRaw()`) and `customClient` sockets keep their current one-schema-per-path
behaviour.

## Public API

```ts
// chat.ts — the connection, declared ONCE. Contract and schema stay separate objects.
export const ChatContract = new GGDuplexExtendableContract("Chat", {
    connect: {input: IsChatQuery, errors: [NOT_AUTHORIZED, SERVER_ERROR]},
})
export const ChatSocket = new GGWebSocketExtendableSchema({
    contract: ChatContract,
    path: "ws/chat",
    use: [USER_TOKEN_WIRE],
})

// messaging.ts — only methods; connect/path/use inherited.
export const Messaging = ChatContract.extend("Messaging", {
    clientToServer: {send: {input: IsMsg, success: IsAck, errors: [SERVER_ERROR]}},
    serverToClient: {message: {input: IsMsg}},
})
export const MessagingSocket = ChatSocket.extend(Messaging)

// presence.ts
export const Presence = ChatContract.extend("Presence", {
    clientToServer: {setStatus: {input: IsStatus}},
    serverToClient: {presenceChanged: {input: IsStatus}},
})
export const PresenceSocket = ChatSocket.extend(Presence)
```

Server — each extension bound **separately** on the same `GGHttp`:

```ts
new GGHttp(http)
    .ws(MessagingSocket, messagingService.handle)
    .ws(PresenceSocket,  presenceService.handle)
// Both resolve to ONE socket server on path "ws/chat".
```

Client — each extension a typed client; they pool automatically:

```ts
const messaging = MessagingSocket.createClient()
const presence  = PresenceSocket.createClient()
await messaging.connect(({incoming}) => incoming.on({message: ...}))
await presence.connect(({incoming})  => incoming.on({presenceChanged: ...}))
// One physical connection, two handles.
```

## Semantics & rules

- **Sharing is instance-based, never path-based.** The sharing key is the base
  identity (`ChatSocket` / `ChatContract`). Siblings pool because they trace back to
  the same anchor. A different base reusing `"ws/chat"` does not join — and on the
  server it can't even exist (register-once below).
- **`ChatSocket.extend(c)` only accepts an extension of its own base contract** —
  type-level (`extend(c: ExtensionOf<ChatContract>)`) + runtime
  (`c.parent === ChatSocket.contract`, else throw). The discovery guarantee.
- **The base is never bound or connected directly.** `ChatContract` carries only
  `connect`; `ChatSocket` is the group anchor. Extensions are bound/connected.
- **Path registered exactly once on `GGHttpServer`.** The strict register-once in
  `attachUpgradeDispatch` (`GGSocketServer.ts`) stays. The group's `GGSocketServer`
  registers the path on first extension bind; later extensions attach to it. Two
  unrelated bases on one path still throw.
- **Routing is by the existing name prefix** `` `${name}.${method}` `` via
  `socket.registerHandler` (`GGWebSocketSchema.startServer.ts:51`). No new routing.
- **Unique module name per group — checked eagerly** in `ChatContract.extend(name, …)`.
  No next-tick: names don't depend on the full set; connect/path/use are inherited,
  methods are namespaced — nothing cross-sibling to validate.

## New types

`packages/schema/.../GGDuplexExtendableContract.ts`
- `new GGDuplexExtendableContract(name, {connect, clientToServer?, serverToClient?})`
  — base duplex contract holding `connect` (+ optional shared methods) and a registry
  of child names.
- `.extend(name, {clientToServer, serverToClient})` → a `GGDuplexContract` that reuses
  the base's `connect` by reference, carries its own method maps (typed to just those),
  and holds `parent = <base>`. Throws on duplicate `name`.

`packages/http/websocket/.../GGWebSocketExtendableSchema.ts`
- `new GGWebSocketExtendableSchema({contract, path, use})` — wraps the extendable
  contract with `path`/`use`. The group anchor.
- `.extend(childContract)` → a `GGWebSocketSchema` with `path`/`use` inherited,
  `contract = childContract`, `group = <anchor>` as the sharing key. Type/runtime-
  rejects a contract whose `parent` isn't this anchor's contract.

Returned per-module objects are ordinary `GGWebSocketSchema`s → `.createClient()` and
`.ws(schema, handler)` work unchanged, typed to their own methods.

## Server design

Unified path today: `GGHttp.ws(schema, handler)` (`GGHttp.ws.ts`) →
`startWebSocketServer(...)` (`GGWebSocketSchema.startServer.ts:18`) →
`prepareSocketServer(schema, config)` (`prepareSocketServer.ts:33`, shared with raw) →
`new GGSocketServer(...)` + one `onConnection` contributor wiring c2s/s2c per `GGSocket`.

`prepareSocketServer` already registers the schema, builds
`[...schema.middlewares, ...config.middlewares]` + the connect-permission gate, and
extracts `queryValidator`/`connectPermission` from `contract.connect.method`.

Target: one `GGSocketServer` **per group** (keyed by anchor instance on a given
`http.Server`):
- No server for the group → run `prepareSocketServer` against the **anchor** (base
  connect + use) → registers the path once → create the `GGSocketServer`.
- Server exists → assert the extension belongs to the group; skip create.
- Always: attach the extension's `onConnection` contributor (the c2s/s2c wiring loop
  at `GGWebSocketSchema.startServer.ts:34-76`, per-extension, reusing the group's
  `permissionsChecker`). `GGSocketServer.onConnection` already runs all contributors.
- One handshake per connection is correct (shared connect/use). Per-method grant
  checks stay per-extension.
- `onStart`/`onTeardown`/`GG_DISCOVERY` run once per group; connection labels key by
  **path**, not a single `apiName` (per-message metrics carry the extension via
  `msg.path`).

Likely shape: a `prepareGroupSocketServer` owning the per-`(httpServer, group)`
lookup+create-once, keeping `startWebSocketServer` thin and the standalone
`GGWebSocketSchema` path untouched.

## Client design

Today: `createClient()` (`GGWebSocketSchema.createClient.ts`) builds a `connector`
(`reconnectConnector.ts`) 1:1 with a socket and opens via `GGSocketPool.connect()`.

Target: a **shared pooled connection per group**, each `createClient` a refcounted
handle.
- Pool key = group identity + resolved params (url/query/headers). Same → shared;
  different connect query → separate socket under the same group.
- Shared connection owns one `connector` (one reconnect loop, one heartbeat). First
  handle opens; later handles attach + bump refcount.
- Each handle registers its namespaced incoming handlers (`buildSetupTools`); the
  shared connection re-runs all live handles' setups on every (re)connection.
- `onClose`/`onError`/`onDisconnect` fan out to handles.
- `disconnect()`/`close()` decrement refcount; socket closes only when the last handle
  releases.
- Open path routes through the shared connection (`GGSocketPool.getOrConnect` keyed by
  group) instead of `connect()`.

## Edge cases

- `extend(foreignContract)` (parent mismatch) → throw (type + runtime).
- Duplicate module name on a base → throw eagerly at `.extend()`.
- Second unrelated base on the same path → `attachUpgradeDispatch` throws.
- Group mixed with `.wsRaw()`/`customClient` on one path → rejected (out of scope).
- Client: one handle `disconnect()` while another live → socket stays up.
- Client: reconnect re-runs every live handle's setup exactly once.
- Client: two handles with different connect query → separate sockets.

## Files

New:
- `packages/schema/.../GGDuplexExtendableContract.ts`
- `packages/http/websocket/src/schema/GGWebSocketExtendableSchema.ts`

Changed:
- `packages/http/websocket/src/server/GGWebSocketSchema.startServer.ts` — group-aware
  create-or-attach; per-extension contributor.
- `packages/http/websocket/src/server/prepareSocketServer.ts` — per-`(httpServer, group)`
  lookup/create-once (or a sibling `prepareGroupSocketServer.ts`).
- `packages/http/websocket/src/server/GGSocketServer.ts` — minor; path-based labels.
- `packages/http/websocket/src/client/GGWebSocketSchema.createClient.ts` — handle model.
- `packages/http/websocket/src/client/GGSocketPool.ts` (+ a `PooledConnection` helper)
  — refcounted shared connection keyed by group.

## Testing (`@grest-ts/testkit`)

1. Two extensions of one group → both clients work over one socket (assert one
   physical connection).
2. `extend(foreignContract)` → throws.
3. Duplicate module name → throws at `.extend()`.
4. Second unrelated base on the same path → throws at bind.
5. Client refcount: A `disconnect()` leaves B working; socket closes after both release.
6. Reconnect: drop socket; both handles' setups re-run; both resume.
7. Different connect query per handle → distinct sockets.
8. Raw/customClient path unaffected.

## Build order

1. `GGDuplexExtendableContract` + `GGWebSocketExtendableSchema` + eager checks. Tests 2,3.
2. Server: group-aware `startWebSocketServer` / `prepareSocketServer` + contributors. Tests 1,4,8.
3. Client: pooled connection + refcount + handle model. Tests 5,6,7.
4. Full `run_tests` sweep.

## Out of scope

- Raw / `customClient` sockets.
- Cross-`http.Server` / cross-process sharing.
- Binding/connecting the base anchor directly.
