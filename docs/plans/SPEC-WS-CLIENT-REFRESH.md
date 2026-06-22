# WS client: refreshable connection params (`beforeConnect`)

> The reconnect connector re-runs `open()` per attempt, but the **inputs** to
> `open()` (`url`, `query`, and any client-supplied credential) are frozen at
> `createClient(...)` time. So a short-lived / rotating credential — a per-connection
> minted token, a `?token=` query, a signed URL — goes stale, and built-in reconnect
> re-handshakes with a dead credential. Today consumers work around it by disabling
> reconnect and hand-rolling their own loop that re-mints the credential each attempt.
>
> Add a `beforeConnect` hook: an async provider of the volatile connection params,
> resolved **inside** `open()` so it runs on the single shared connect path — first
> connect and every reconnect, identically.

## Why the existing escape isn't enough

`GGReconnectConfig.shouldRetry` already lets a client retry on `NOT_AUTHORIZED`
(see hub-client's `SocketClient`: on `NOT_AUTHORIZED` it calls `refreshUserToken()`
then returns `true`). But that only works when the credential is sourced **behind a
wire** (a cookie/session the refresh mutates out-of-band) — the next handshake reads
the refreshed source. When the client **supplies the credential directly** (a `query`
token, a per-connection minted token, a header written by a `config.middlewares`
entry), there is no way to swap in a fresh value on the next attempt: `config.url` /
`config.query` / `config.middlewares` are captured once. That is the gap.

## Design

Add to the client config (shared by the typed and raw `createClient`). The connection params
come from exactly ONE of two **mutually-exclusive** sources, expressed as a discriminated union
so mixing them is a **compile error** (not just a runtime "sole source" rule):

```ts
type GGWebSocketClientConfig<TQuery> =
    // behaviour, common to both modes
    { reconnect?: boolean | GGReconnectConfig; timeout?: number; logMode?: GGWsLogMode } & (
    // static: fixed connection params, captured once
    | { url?: string; query?: TQuery; middlewares?: GGTransportMiddleware[]; beforeConnect?: never }
    // dynamic: resolved before EVERY connect attempt (first + every reconnect) — for short-lived /
    // rotating credentials. Returns the COMPLETE url/query/middlewares each time (never stale).
    // Cannot be combined with the static fields above (they are `never` in this arm).
    | {
        beforeConnect: () => GGConnectParams<TQuery> | Promise<GGConnectParams<TQuery>>
        url?: never; query?: never; middlewares?: never
      }
    )

interface GGConnectParams<TQuery> {
    url?: string
    query?: TQuery
    middlewares?: GGTransportMiddleware[]
}
```

`beforeConnect` runs inside the connect path. On a RECONNECT attempt a throw is fed to
`shouldRetry` (transient mint failure → backoff; `NOT_AUTHORIZED` / `FORBIDDEN` /
`VALIDATION_ERROR` → terminal, final close "unrecoverable"). On the FIRST connect a throw
rejects `connect()` directly (the initial attempt is not retried — decision (a) below). Schema
`.use()` wires always apply on top of either mode.
```

## Where it lives — the single-path guarantee

The connector (`client/reconnectConnector.ts`) already funnels **both** the initial
connect and every reconnect through one function:

- `connect()` → `await openOnce()`
- `scheduleReconnect()`'s timer → `await openOnce()`
- `openOnce()` → `hooks.open()` then `hooks.setup(socket, reconnectAttempt > 0)`

So `beforeConnect` is resolved **inside each client's `open()` hook** — the one
function every attempt already calls. There is no reconnect-only open path to wire
wrong; the first connect fully exercises the same `open()` (incl. `beforeConnect`)
that reconnect uses. The connector itself does not change.

Each `createClient`'s `open()` hook changes from reading static config to:

```ts
open: async () => {
    // beforeConnect, when set, is the SOLE source — no merge with static config.
    const fresh  = config.beforeConnect ? await config.beforeConnect() : undefined
    const url    = fresh ? fresh.url        : config.url
    const query  = fresh ? fresh.query      : config.query
    const cliMws = fresh ? fresh.middlewares : config.middlewares
    const domain   = await resolveWsDomain(url, schemaName)
    const fullUrl  = buildWsUrl(domain, normalizedPath, validateWsQuery(queryValidator, query))
    return openClientConnection({ adapter: new AdapterClass(fullUrl), domain, middlewares: [...schemaMiddlewares, ...(cliMws ?? [])], ... })
},
```

Two invariants make first == reconnect by construction:
1. **All volatile-input resolution lives in `open()`** (run every `openOnce()`), never
   captured at `createClient()` time.
2. **`setup()` must not branch on `isReconnect`.** The flag stays available (some
   clients log differently) but handler wiring must be identical on first and
   subsequent opens; if a client ever needs reconnect-specific setup, that branch is
   the one thing worth a dedicated test.

## Semantics

- **When:** before the first connect and before every reconnect attempt.
- **Sole source, type-enforced (decision):** `url`/`query`/`middlewares` come from *either*
  the static fields *or* `beforeConnect`, never both — the config is a discriminated union, so
  setting a static field alongside `beforeConnect` is a **compile error**. `beforeConnect`
  returns the complete set each attempt; schema `.use()` wires always apply on top.
- **Validation every attempt (decision):** the returned `query` is validated on every
  attempt via `validateWsQuery`. A `VALIDATION_ERROR` is **terminal** (added to the
  default `shouldRetry`'s terminal set, alongside `NOT_AUTHORIZED` / `FORBIDDEN`) — a
  malformed query won't fix itself by retrying, so the whole client fails rather than
  spinning in a backoff storm.
- **Errors:** on a **reconnect** attempt a throw is fed to the retry path — backoff +
  `scheduleReconnect` unless `shouldRetry(err)` is false (auth + validation errors are
  terminal → `onClose("unrecoverable")`; a transient mint failure backs off). On the
  **first** connect a throw rejects `connect()` directly — the initial attempt is **not**
  auto-retried (decision (a)); initial-retry, if wanted, stays the caller's concern.
- **Always fresh:** because it runs on attempt #1 too, callers never pre-mint; there is
  no "captured once" value, so staleness cannot occur.
- **Both client kinds:** typed (`GGWebSocketSchema.createClient`) and raw
  (`GGRawWebSocketSchema.createClient`) — both build a connector with an `open()` hook,
  so each gets the same `beforeConnect` resolution.

## Developer usage

Typed:
```ts
const client = EventsApi.createClient({
    reconnect: true,
    beforeConnect: async () => {
        const a = await mintAccess()                 // short-lived token + endpoint
        return { url: a.url, query: { token: a.token } }
    },
})
client.connect(({incoming}) => incoming.on({ onEvent: async (e) => handle(e) }))
// teardown: client.close()
```

Raw byte stream:
```ts
const client = PtyApi.createClient({
    reconnect: true,
    beforeConnect: async () => ({ url: a.url, query: { token: (await mintAccess()).token } }),
})
client.onMessage((data, isBinary) => isBinary ? term.write(data) : handleControl(data))
await client.connect()
term.onData(bytes => client.send(bytes))
```

No reconnect loop, backoff, or token-refresh plumbing in app code.

## Out of scope / non-goals

- Not a credential-placement abstraction: `beforeConnect` returns raw connect inputs
  (`url`/`query`/`middlewares`); where a credential rides is still the schema's /
  caller's choice. (A credential-only `auth: () => token` provider was considered and
  rejected — it only helps wire-delivered creds, and `beforeConnect` subsumes it.)
- `shouldRetry`, heartbeat, backoff config: unchanged. The cookie/wire out-of-band
  refresh pattern (`SocketClient`) stays valid and orthogonal.
- Server side: unchanged.

## Consumer

kratt deletes the hand-rolled reconnect loops in all five WS clients — typed
`workspaceEventsConnection` (`/ws/events`) and the raw terminal / ide / test clients —
collapsing each to `reconnect: true` + `beforeConnect` (mint via
`terminalAccess.getAccessToken`, which returns both the relay URL and a fresh token).
```
