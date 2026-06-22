# Unified WebSocket socket API (`@grest-ts/websocket`)

> Collapse the three socket constructs — typed schema, raw byte stream, and
> foreign-client passthrough — into **one builder over one engine**. Today they
> share a single connection pipeline (`GGSocketServer`) but are exposed through
> three inconsistent public surfaces. This unifies the surface to match the unity
> that already exists underneath, makes byte streams first-class (reconnect +
> docs), and folds passthrough in as a terminal rather than a boolean flag.
>
> **Breaking by design.** kratt is the only consumer; no back-compat shims.

## Why

A socket today is built one of three ways:

| | construction | payload | auth timing | client reconnect/liveness | in AsyncAPI docs |
|---|---|---|---|---|---|
| `webSocketSchema(contract).path()…done()` | fluent builder | typed contract | first-message handshake | ✅ (`createClient`) | ✅ |
| `rawSocketSchema(name, {…})` | options bag | bytes | first-message handshake | ❌ (`createRawClient` connect-once) | ❌ |
| `rawSocketSchema(name, {passthrough:true})` | options bag + flag | bytes | HTTP upgrade | n/a (foreign client) | ❌ |

Three problems:

1. **Two construction idioms** (fluent vs options bag) for the same family.
2. **`passthrough` is a boolean** that silently changes auth semantics *and* restricts which middlewares are legal — a flag that mutates the meaning of other fields.
3. **Byte streams are second-class**: no client reconnect/liveness (the schema client has it; the raw client doesn't), and they never reach the AsyncAPI docs (raw `startServer` doesn't register in `registeredWebSocketSchemas`).

But the *engine* is already one thing: a single `GGSocketServer` whose connection
pipeline (path dispatch → query validation → auth → open socket) is identical for
all three. Only two things truly vary.

## The model: one pipeline, two forks

- **Payload** — typed message contract (→ `GGSocket`) or opaque bytes (→ `GGRawSocket`).
- **Mode** — *grest-ts-both-ends* (in-band first-message auth, `HANDSHAKE_OK`, reconnect/liveness) or *passthrough/foreign* (auth at the upgrade, no first message, no grest-ts client).

`messages` and `bytes` are grest-ts-both-ends (they differ only by payload).
`passthrough` is foreign and always bytes (a foreign client can't speak a typed
grest-ts contract). So: **one builder, three terminals.**

## Public API

```ts
// typed — grest-ts both ends, first-message auth, reconnect/liveness, docs(messages)
export const Events = webSocketSchema("Events")
    .path("/ws/events").use(GG_RELAY_TOKEN).queryOnConnect(IsQ).connectPermission(P)
    .messages({
        clientToServer: { /* … */ },
        serverToClient: { onSnapshot: {input: IsSnap}, onEvent: {input: IsEvent} },
    })

// raw bytes — grest-ts both ends, first-message auth, reconnect/liveness, docs(byte-channel)
export const Terminal = webSocketSchema("Terminal")
    .path("/ws/terminal").use(GG_RELAY_TOKEN).queryOnConnect(IsTokenQ)
    .bytes()

// passthrough — foreign client, UPGRADE auth only, no first message, docs(byte-channel)
export const Desktop = webSocketSchema("Desktop")
    .path("/ws/desktop").use(DESKTOP_TOKEN_QUERY)
    .passthrough({ protocols: ["binary"] })
```

`webSocketSchema(name)` now takes the **name** (was the contract). The contract's
method maps move into `.messages({clientToServer, serverToClient})`, so
`defineSocketContract` is **absorbed** and removed. The builder owns the common
connection config (`path` / `use` / `queryOnConnect` / `connectPermission`); the
terminal picks payload + mode and finalizes (no `.done()`).

### Behavior per terminal

| terminal | server handler | client | auth | readiness | docs |
|---|---|---|---|---|---|
| `.messages(c)` | `(incoming, outgoing)` | `createClient` → typed + reconnect/liveness | first message | `HANDSHAKE_OK` | messages |
| `.bytes()` | `(socket: GGRawSocket)` | `createClient` → raw handle + reconnect/liveness | first message | `HANDSHAKE_OK` | byte-channel |
| `.passthrough({protocols})` | `(socket: GGRawSocket)` | **none** (foreign) | upgrade (cookie / `?query=`) | none (server `pause`/`resume`) | byte-channel |

## Auth rules (structural, not runtime flags)

1. **First-message ("header") auth is the default** for `.messages()` / `.bytes()` —
   unchanged from grest-ts today. A `GGHeader` wire delivers its credential in the
   in-band handshake (its `update()` writes it; the server reads it from the
   handshake message). Cookie/query wires also work (read from the real upgrade).
2. **`.passthrough()` forbids in-band auth.** At registration, any `.use()`'d
   wire/middleware with an `update()` (needs in-band delivery — e.g. `GGHeader`)
   **throws**: a foreign client never sends the handshake, so that credential could
   never arrive and the socket would open unauthenticated while looking gated.
   Only upgrade-readable credentials (cookie, `?query=`) are legal. This is the
   defining invariant of the terminal — not a check bolted onto a boolean.

## Client

One method: `createClient`. Its return type follows the terminal — a typed client
for `.messages()`, a raw byte handle (`send` / `onMessage` / `onClose` / `close`)
for `.bytes()`. `.passthrough()` has **no** grest-ts client (the client is foreign;
its reconnect is the foreign library's concern).

**Reconnect + liveness become shared connector code** used by both the typed and
raw clients (today they live only inside the typed `createClient`). This is the
concrete payoff: a raw-stream consumer gets `createClient({reconnect: true})` with
backoff + half-open detection instead of hand-rolling it. `createRawClient` is
removed.

## Docs (AsyncAPI)

All three terminals register in `registeredWebSocketSchemas`. `toAsyncApi` gains a
**byte-stream channel** emitter for `.bytes()` / `.passthrough()` schemas: path,
auth (wires), direction (bidirectional opaque binary), no message component. Every
socket surface — typed or raw — becomes visible in the generated docs.

## What breaks (removed)

- `webSocketSchema(contract)` signature → `webSocketSchema(name)`.
- `rawSocketSchema(name, {…})` constructor → `.bytes()` / `.passthrough()` terminals.
- `defineSocketContract(...)` → folded into `.messages({clientToServer, serverToClient})`.
- `createRawClient` → folded into `createClient`.
- `.done()` → the terminal finalizes.
- `passthrough` / `protocols` as options-bag fields → the `.passthrough({protocols})` terminal.

## Internal (mostly unchanged)

`GGSocketServer` keeps its `{payload: "typed"|"raw", passthrough}` config and its
two small forks in `_onConnection` (auth timing; socket type). The builder is the
thing being rewritten; the engine is fed coherently by it. Server-side per-socket
heartbeat already covers `.bytes()` / `.passthrough()`.

## Migration (kratt — the only consumer)

- `/ws/events` → `webSocketSchema("Events").…messages(...)` (mechanical rename from
  the current `defineSocketContract` + `webSocketSchema(contract)`).
- terminal / test / ide relay streams → `.bytes()`; browser clients →
  `createClient({reconnect})`, deleting their hand-rolled reconnect/liveness.
- desktop / code-server → `.passthrough({protocols})`; foreign browser clients
  (noVNC, VS Code) unchanged.
- `RelayWsGateway` deleted; activity tracking extracted to a standalone
  `ActivityTracker`. All upgrades flow through grest-ts's one dispatcher.

## Out of scope

- Subprotocol-as-auth (rejected: first-message header auth stays the default).
- A `messages` + upgrade-auth combo (not needed; cookie/query already read from the
  upgrade under first-message mode).
