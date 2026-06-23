# Spec: WebSocket Connection Pooling

## Motivation

grest-ts typed WebSocket contracts name each message `${schemaName}.${methodName}`.
This means two *different* contracts sharing one physical connection have fully
disjoint handler namespaces and never conflict. Today `createClient()` always opens a
dedicated connection, which means two contracts at the same URL open two physical
WebSocket connections even though one would do.

The practical goal: in a multi-feature architecture, several feature packages can each
define their own typed WS contract pointing at the same relay path. The browser opens
one connection; each contract client registers its handlers independently; the
framework routes incoming frames by the full `schema.method` path.

## Design Goals

1. Same URL + same auth headers → one physical connection, shared by all clients at
   that URL.
2. Opt-out: a caller can request a dedicated connection when it needs independent
   lifecycle control.
3. Reconnect: when the shared connection drops, all registered clients are notified
   and their setup hooks re-run (re-registers handlers and re-sends any initial
   messages).
4. Disconnect: when one client disconnects, only its handlers are removed from the
   socket. The connection stays open as long as at least one other client is attached.
   When the last client disconnects, the connection closes.
5. Raw sockets: not pooled. Raw byte-stream clients own their socket exclusively; the
   semantics of sharing a byte stream are undefined.

## API Changes

### `createClient` config — new `dedicated` flag

```ts
// Current (unchanged interface shape)
ChatApi.createClient({ url: "wss://relay" })

// Explicitly opt out of pooling
ChatApi.createClient({ url: "wss://relay", dedicated: true })
```

`dedicated` defaults to `false` (pooled). Pooling is keyed on the resolved URL plus
the serialized auth headers (exactly the current `GGSocketPool.getOrConnect` key).

### `connect()` — unchanged

No change to the `connect(setup?)` call. The setup callback is re-invoked on every
successful (re)connection, which is already the right contract for pooled clients.

## Implementation

### Pool entry structure

Replace the current `Map<string, GGSocket>` in `GGSocketPool` with:

```ts
interface PoolEntry {
    socket: GGSocket | null            // null while reconnecting
    pending: Promise<GGSocket> | null  // non-null while first connect in flight
    refCount: number                   // number of attached clients
    connector: ReconnectConnector      // owns the reconnect loop
    setupHooks: Map<symbol, SetupHook> // one per attached client, keyed by client id
}

type SetupHook = (socket: GGSocket) => Promise<void>
```

### `getOrConnect` (updated) — pooled path

1. Build key from `fullUrl + "::" + headerKey` (unchanged).
2. If a `PoolEntry` exists: increment `refCount`, return the entry's `connector`.
3. If not: create a new `PoolEntry` with `refCount = 1`, create a single
   `ReconnectConnector` for this entry, start connecting.
4. The `PoolEntry`'s connector is responsible for the reconnect loop. On every
   successful (re)connect it iterates `setupHooks` and calls each one against the new
   socket.

### `connect` (unchanged) — dedicated path

Returns a fresh `GGSocket` that is not registered in the pool. Lifecycle is fully
owned by the caller.

### `createClient` changes

```ts
// pooled (default)
open: async () => {
    const { url, query, middlewares } = await resolveConnectParams(config)
    const domain = await resolveWsDomain(url, schemaName)
    return GGSocketPool.getOrConnect({      // ← was GGSocketPool.connect
        domain, path, query, middlewares,
        setup: setupHook,                   // ← new: register this client's setup
        clientId,                           // ← new: symbol for this client instance
    })
},
```

When the client is disconnected (user calls `disconnect()` or `close()`):
- Call `GGSocketPool.detach(key, clientId)`.
- `detach` decrements `refCount`.
- If `refCount` reaches 0: close the shared socket and remove the pool entry.
- If `refCount` > 0: only unregister this client's handlers from the socket (remove
  the handlers that were registered under `${schemaName}.*`).

Handler unregistration requires `GGSocket.unregisterHandlers(prefix: string)` — a new
method that removes all handlers whose path starts with `prefix`. Called with
`schemaName + "."` when a pooled client detaches.

### Reconnect with multiple clients

The single `ReconnectConnector` per pool entry drives the reconnect loop. Its `setup`
callback runs all registered `setupHooks` in sequence after each successful reconnect.
Order is insertion order (Map preserves it). Each hook re-calls `incoming.on({...})`
which re-registers that client's handlers on the fresh socket.

If a hook throws, the error is isolated (logged, not propagated) so the remaining
clients' hooks still run.

### Conflict guard (same contract, same URL)

If the same contract is instantiated twice at the same URL with pooling, the second
`createClient` would try to register `schema.method` handlers that already exist from
the first client. `registerHandler` currently overwrites silently (Map.set).

Two options — pick the simpler one during implementation:

**Option A (simple):** Log a warning and overwrite. This is the existing behavior and
works correctly when the first client has disconnected (its handlers are gone). It is
incorrect only when both clients are simultaneously attached.

**Option B (strict):** At `incoming.on()` time, if a handler path is already
registered on the shared socket, throw an error telling the caller to use
`{dedicated: true}`. This surfaces the problem at dev time.

**Recommendation: Option B**, as it makes misuse visible immediately.

### Raw sockets

`GGRawWebSocketSchema.createClient()` uses `openClientConnection` directly and does
not go through `GGSocketPool`. No change needed. Raw sockets are always dedicated.

The `dedicated` flag is typed on `GGWebSocketClientConfig`, which is the typed-only
config type. It does not appear on the raw client config type.

### Pool storage strategy (browser vs Node.js)

`GGSocketPool` must not import `@grest-ts/locator` — the browser bundle must never
pull in Node-only `AsyncLocalStorage` code. Pool storage is therefore injectable via
the same augmentation pattern used elsewhere in grest-ts (`_initLocatorStorage`,
`_registerWsDiscoveryUrlResolver`, etc.).

**`GGSocketPoolStorage.ts`** — lives next to `GGSocketPool.ts`, browser-safe default:

```ts
export interface PoolStorageStrategy {
    getPool(): PoolBucket
}

export interface PoolBucket {
    sockets: Map<string, PoolEntry>
    pending: Map<string, Promise<GGSocket>>
}

// Default: one global bucket — correct for browser (single async context).
const globalBrowserBucket: PoolBucket = {sockets: new Map(), pending: new Map()}
let _strategy: PoolStorageStrategy = {getPool: () => globalBrowserBucket}

export function _initPoolStorage(s: PoolStorageStrategy): void { _strategy = s }
export const GG_POOL_STORAGE: PoolStorageStrategy = {getPool: () => _strategy.getPool()}
```

**`GGSocketPool.node.ts`** — side-effect-only augmentation, same pattern as
`createClient.node.ts`:

```ts
import {GGLocator} from "@grest-ts/locator"
import {_initPoolStorage, type PoolBucket} from "./GGSocketPoolStorage"

const pools = new WeakMap<object, PoolBucket>()
const fallback: PoolBucket = {sockets: new Map(), pending: new Map()}

_initPoolStorage({
    getPool() {
        const scope = GGLocator.tryGetScope()
        if (!scope) return fallback
        if (!pools.has(scope)) pools.set(scope, {sockets: new Map(), pending: new Map()})
        return pools.get(scope)!
    },
})
```

`index-node.ts` adds `import "./client/GGSocketPool.node"`. `index-browser.ts` —
no change, never sees `@grest-ts/locator`.

`GGSocketPool` replaces `this.sockets` / `this.pendingSockets` with
`GG_POOL_STORAGE.getPool().sockets` / `.pending` throughout. `closeAll()` naturally
tears down only the current scope's bucket since it reads `getPool()` in the calling
async context — a runtime teardown runs inside its own scope, so only its connections
are closed.

**Isolation guarantee:** two runtimes in the same process each run under their own
`GGLocatorScope`. `GGLocator.tryGetScope()` returns a different object per runtime,
so `WeakMap` lookups produce separate `PoolBucket` instances. Features within the
same runtime share one bucket (intended) while features across runtimes cannot share
pool entries (required).

## Server-side @TODO (separate, out of scope for this spec)

The existing comment in `GGWebSocketSchema.startServer.ts`:

```
// @TODO We might want some lookup here based on path/middlewares etc.
// If I use same socket for multiple paths, we need to reuse also same GGSocketServer.
```

This is about server-side multiplexing: if two schema servers bind the same path they
currently fail (`path already registered` error). A path registry lookup would let
them coexist. This is a server-side concern orthogonal to client pooling. Track
separately.

## Edge Cases

| Scenario | Behaviour |
|---|---|
| Two different contracts, same URL | Pooled to one socket. Handlers are `A.m1`, `B.m1` — no conflict. |
| Same contract, same URL, pooled | Option B: throws at `incoming.on()` time. Use `{dedicated: true}` instead. |
| Client disconnects while pooled | `detach` removes its handlers; socket stays open for other clients. |
| Last client disconnects | Socket closes; pool entry removed. |
| Socket drops (network error) | Single reconnect loop fires; all clients' setup hooks re-run on new socket. |
| Client calls `forceReconnect()` | Forces the pool entry's connector to reconnect; all clients get fresh setup. |
| Raw socket | Always dedicated. `dedicated` flag not applicable. |
| `dedicated: true` | Skips pool entirely; behaves exactly as today. |
| `connect()` called before setup | Unchanged — throws `SERVER_ERROR` with "call connect() first". |

## Migration

No breaking changes. Existing call sites (`createClient()` with no `dedicated` flag)
switch from dedicated to pooled automatically. Callers that need isolation pass
`{dedicated: true}`.

In practice, every existing call that opens a solo client for a unique URL continues
to work correctly — the pool entry has `refCount = 1` and the behavior is identical
to a dedicated connection.

## Files to Change

| File | Change |
|---|---|
| `GGSocketPoolStorage.ts` (new) | `PoolStorageStrategy` interface + `PoolBucket` type + browser default + `_initPoolStorage` |
| `GGSocketPool.node.ts` (new) | Node strategy: `WeakMap<GGLocatorScope, PoolBucket>` keyed on current scope |
| `GGSocketPool.ts` | Replace static `sockets`/`pendingSockets` maps with `GG_POOL_STORAGE.getPool().sockets/.pending`; replace `Map<string, GGSocket>` pool type with `Map<string, PoolEntry>`; add `detach(key, clientId)`; add `setup` and `clientId` params to `getOrConnect` |
| `index-node.ts` | Add `import "./client/GGSocketPool.node"` |
| `GGWebSocketSchema.createClient.ts` | Default to `getOrConnect`; pass setup hook and clientId; call `detach` on disconnect/close; add `dedicated` flag to config |
| `GGSocket.ts` | Add `unregisterHandlers(prefix: string)` method |
| `GGWebSocketClientConfig` (types) | Add `dedicated?: boolean` |
| Tests | Add: pooling deduplication, multi-contract same-URL, detach-with-others-alive, reconnect-all-hooks, dedicated opt-out, same-contract-same-URL error, cross-runtime isolation (two scopes → separate pool entries) |
