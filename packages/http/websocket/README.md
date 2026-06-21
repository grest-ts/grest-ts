<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# WebSocket Package Usage (@grest-ts/websocket)

How to use the WebSocket package for building type-safe, bidirectional WebSocket APIs.

## WebSocket API Definition

### Defining a Contract

WebSocket contracts define two-way communication channels:
- `clientToServer` — methods the client can call on the server (RPC-style)
- `serverToClient` — messages the server can push to the client

```typescript
// NotificationApi.ts
import { defineSocketContract, webSocketSchema } from "@grest-ts/websocket"
import { IsObject, IsString, IsBoolean, IsUint, IsArray, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema"

// ---------------------------------------------------------
// Type Schemas
// ---------------------------------------------------------

export const IsUserId = IsString.brand("UserId")
export type tUserId = typeof IsUserId.infer

export const IsMessage = IsObject({
    id: IsString,
    text: IsString,
    senderId: IsUserId,
    timestamp: IsUint
})
export type Message = typeof IsMessage.infer

export const IsSendMessageRequest = IsObject({
    text: IsString.nonEmpty,
    channelId: IsString
})

export const IsSendMessageResponse = IsObject({
    success: IsBoolean,
    messageId: IsString
})

export const IsTypingEvent = IsObject({
    userId: IsUserId,
    channelId: IsString
})

// ---------------------------------------------------------
// Contract & API
// ---------------------------------------------------------

// The contract declares the payload mode (typed methods here); webSocketSchema
// binds the transport. Held as a named contract so the inferred types are reusable
// (see Server Setup).
export const ChatContract = defineSocketContract("Chat", {
    clientToServer: {
        // RPC: client sends a request, server responds
        sendMessage: {
            input: IsSendMessageRequest,
            success: IsSendMessageResponse,
            errors: [VALIDATION_ERROR, SERVER_ERROR]
        },
        // Fire-and-forget: no response expected
        markAsRead: {
            input: IsObject({ messageId: IsString })
        },
        ping: {}
    },
    serverToClient: {
        // Push: server sends data to client
        newMessage: {
            input: IsMessage
        },
        typing: {
            input: IsTypingEvent
        },
        // Server can also request a response from the client
        areYouThere: {
            success: IsBoolean,
            errors: [SERVER_ERROR]
        }
    }
})

export const ChatApi = webSocketSchema(ChatContract)
    .path("ws/chat")
    .done()
```

### Contract Method Types

Every method supports two sending modes, determined by the contract shape:

- **Request-response** (has `success`) — the sender waits for a typed reply. Use for RPC-style calls where you need a result or confirmation.
- **Fire-and-forget** (no `success`) — the message is sent without waiting. Use for notifications, events, and one-way signals.

Both modes work in either direction (`clientToServer` and `serverToClient`).

```typescript
const MyContract = defineSocketContract("My", {
    clientToServer: {
        // Request-response: has input + success + errors
        // Client sends a request, server returns a typed response
        update: {
            input: IsUpdateRequest,
            success: IsUpdateResponse,
            errors: [VALIDATION_ERROR, SERVER_ERROR]
        },
        // Fire-and-forget with data: has input only
        // Client sends data, does not wait for a response
        notify: {
            input: IsNotifyRequest
        },
        // Fire-and-forget without data: empty object
        ping: {}
    },
    serverToClient: {
        // Same patterns apply for server-to-client messages
    }
})

webSocketSchema(MyContract).path("ws/my").done()
```

### Schema Builder

The payload mode lives on the **contract** — a typed contract (`clientToServer` / `serverToClient`), a `{ bytes: true }` byte stream, or a `{ bytes: true, customClient: true }` foreign-client byte stream (see "Byte-stream sockets"). `webSocketSchema(contract)` then configures the endpoint and binds the transport uniformly for all three, finalized by `.done()`.

```typescript
export const ChatApi = webSocketSchema(ChatContract)        // the contract carries the payload mode
    .path("ws/chat")                                        // WebSocket endpoint path
    .use(USER_TOKEN_WIRE)                                   // attach a credential wire (verified at handshake)
    .connectPermission(ChatPermission.USE)                  // optional handshake-level permission gate
    .queryOnConnect(IsObject({ room: IsString }))           // validate query params on connect
    .done()                                                 // finalizes the schema
```

## Permissions

`clientToServer` methods may declare a `permission`; the gate runs **per incoming message**, before the handler. `serverToClient` methods are server-originated and never gated. The opt-in / infectious rule from HTTP applies: any c2s permission declaration or `connectPermission` on any WS schema registered on the same `GGHttpServer` triggers strict mode for the whole server — every HTTP and WS route on it must then declare.

Two gating levels combine:

- **`.connectPermission(...)`** on the schema (optional) is checked at handshake. Use it for feature-specific sockets where lacking permission means there's no point opening the connection at all. Failure closes the socket immediately.
- **Per-c2s-method `permission`** is checked on every incoming message, against scopes that were resolved **once** at handshake and cached on the connection. There is no per-message token re-parsing.

Scopes come from the **wires** the schema `.use()`s — exactly as on HTTP. The wire's `process()` verifies the credential at handshake and its `permissions()` resolver returns the caller's grants. There is no `permissionResolver` config on `register()`; the schema's wires are the only source of scopes:

```typescript
export const ChatApi = webSocketSchema(ChatContract)
    .path("ws/chat")
    .use(USER_TOKEN_WIRE)               // verifies the credential + resolves scopes at handshake
    .connectPermission(ChatPermission.USE)
    .done()

// register() takes only { http?, middlewares? } — no resolver
ChatApi.register(chatService.handleConnection, { http: httpServer })
```

The same refuse-to-start guarantee from HTTP applies: a `.use()`d wire must be implemented (`.define(...).create(deps)` in `compose()`) or the server fails to start; a permissioned route on a wire-less schema fails closed. The strict-mode trigger is shared with HTTP across the same `GGHttpServer`.

**Revocation, accepted limitation.** Scopes are resolved at handshake and cached for the life of the connection. Mid-session revocation (an admin removes a user's `chat:write`) does not take effect until the socket closes — the same constraint that applies to bearer tokens generally. Apps that need strong revocation guarantees on a surface should either avoid long-lived sockets there or close affected connections externally when revoking.

## Wires & Middleware

Authentication and per-request context ride on **wires** — exactly as on HTTP (see
`@grest-ts/http` → "Authentication & Context"). A wire (`GGHeader` / `GGCookie`) is a context
key and a transport middleware at once; attach it with one `.use(WIRE)` on the WS schema. On
WebSocket the wire resolves **once at the connection handshake** (HTTP, by contrast, resolves
per request). A credential wire's `process()` verifies the credential off the upgrade and
mints a durable principal; per-message permission gates read scopes cached at handshake.

### Auth wire (the common case)

The wire and its identity types live in the shared `api/`; the verification handler and the
durable principal live server-side. This is the **same** `USER_TOKEN_WIRE` an HTTP schema
uses — one declaration, both transports.

```typescript
// api/auth/UserAuth.ts  (shared)
import { GGHeader } from "@grest-ts/http"
export const USER_TOKEN_WIRE = new GGHeader("authorization", { scheme: "bearer" })
```

```typescript
// server/auth/UserAuthHandler.ts  (server-only) — runs once at handshake
import { GGContextKey } from "@grest-ts/context"
import { NOT_AUTHORIZED } from "@grest-ts/schema"
import { IsUser, USER_TOKEN_WIRE } from "../../api/auth/UserAuth"

export const USER_DATA = new GGContextKey("userData", IsUser)

export const USER_TOKEN_WIRE_HANDLER = USER_TOKEN_WIRE.define((users: UserService) => ({
    process: async () => {
        const user = await users.verifyAccessToken(USER_TOKEN_WIRE.get())
        if (!user) throw new NOT_AUTHORIZED()
        USER_DATA.set(user)
    },
    permissions: async () => USER_DATA.get()!.permissions,   // feeds per-message gates
}))
```

```typescript
export const ChatApi = webSocketSchema(ChatContract)
    .path("ws/chat")
    .use(USER_TOKEN_WIRE)            // verified at handshake
    .done()

// compose(): bind the handler once per runtime; the same .create() covers HTTP + WS schemas.
USER_TOKEN_WIRE_HANDLER.create(userService)
```

In the connection handler / message handlers, read the durable principal — never the token
(it's ephemeral and already cleared):

```typescript
handleConnection = (incoming, outgoing) => {
    const user = USER_DATA.get()   // identity for this connection
    ...
}
```

### Custom `GGTransportMiddleware` (ambient context)

For *non-credential* connection context (client version, locale, a structured value built
from several headers), implement a `GGTransportMiddleware` directly — the same unified
interface HTTP uses. The runtime normalizes each transport into a `GGInbound` (server reads)
and `GGOutbound` (client writes), so one implementation works on both protocols. Use wires
for credentials; use a custom middleware only for ambient context.

```typescript
interface GGTransportMiddleware {
    update?(outbound: GGOutbound): void    // Client: write handshake/request headers
    parse?(inbound: GGInbound): void       // Server: read inbound credentials
    process?(): Promise<void>              // Server: async validation
    respond?(response: GGResponse): void   // Server: response headers (HTTP only; not called on WS)
}

interface GGInbound  { headers: Record<string, string | undefined>; cookie?: string; query: Record<string, string | undefined> }
interface GGOutbound { headers: Record<string, string> }
```

All methods are optional — implement only what you need. Throwing an error in `parse` or `process` rejects the connection. `respond` writes response headers and is an HTTP-only hook — it is never called on WebSocket, which has no response-header stage.

A middleware (and a `GGCookie` wire) reads the cookie via `inbound.cookie`, not from `inbound.headers`. On WebSocket the runtime fills `inbound.cookie` from the real HTTP upgrade request; the in-band handshake message can never set it, so it can't be spoofed.

### Chaining

```typescript
export const ChatApi = webSocketSchema(ChatContract)
    .path("ws/chat")
    .use(USER_TOKEN_WIRE)      // credential wire
    .use(LocaleMiddleware)     // ambient middleware
    .done()
```

Wires/middleware resolve in order during connection establishment.

### One wire, two transports

Most apps are HTTP-first and add WebSockets later, and want the *same* auth on both. Because
a wire is the single source of truth, you `.use()` the **same wire instance** on both kinds of
schema — and `.create()` its handler once. There is nothing protocol-specific to keep in sync.

```typescript
export const ItemApi = httpSchema(ItemContract).pathPrefix("api/items")
    .use(USER_TOKEN_WIRE)
    .routes({ ... })

export const ChatApi = webSocketSchema(ChatContract).path("ws/chat")
    .use(USER_TOKEN_WIRE)
    .done()
```

The wire's `process()` runs on whichever transport is in play; the durable principal it mints
reads the same in both. Sharing the wire shares *logic* — the *lifecycles* still differ:

**Important — the lifecycles still differ:**

| | HTTP | WebSocket |
|---|---|---|
| When middleware runs | Per request | Once, at handshake |
| What it can do        | Modify each request/response    | Set connection-scoped context |
| Token refresh         | Naturally handled: next request reads the new token | Not automatic — token is captured at connect time. If the token rotates mid-session, the old connection keeps its old identity until it's dropped and a fresh handshake runs |

Sharing the interface shares *logic*, not *lifecycle*: WS middleware still runs only once per connection, so connection-scoped context (identity, scopes) is pinned at handshake and does not re-run on each message. If your HTTP flow needs per-request response behavior that doesn't map to WS (say, writing a `Set-Cookie` via `respond`), that hook is simply never invoked on the WebSocket side — `respond` is HTTP-only.

## Cookies (httpOnly sessions, read-only)

If your app authenticates over HTTP with an httpOnly session cookie (see
`@grest-ts/http` → "Cookies"), that **same cookie authenticates the socket** with no
client code: a browser auto-attaches the cookie to the WebSocket upgrade request (it
can't put an httpOnly cookie into the in-band handshake — JS can't read it). `.use()` a
`GGCookie` wire on the WS schema and read it identically to HTTP.

To turn the cookie into scopes / identity at handshake, `.define()` the cookie wire
(server-side) so its `process()` verifies the session and its `permissions()` resolves
scopes — the same smart-wire model as a token wire, just over a cookie:

```typescript
import {GGCookie} from "@grest-ts/http"
import {GGContextKey} from "@grest-ts/context"
import {NOT_AUTHORIZED, IsString} from "@grest-ts/schema"

// A GGCookie wire over the "session" cookie. Reads the upgrade cookie into the wire.
export const SESSION = new GGCookie("session")
export const SESSION_VALUE = new GGContextKey<string | undefined>("session-value", IsString.orUndefined)

export const SESSION_HANDLER = SESSION.define(() => ({
    process: async () => {
        const v = SESSION.get()                                  // the upgrade cookie value
        if (v === undefined) throw new NOT_AUTHORIZED()          // 401 — rejects the handshake
        SESSION_VALUE.set(v)
    },
    permissions: async () => scopesFromSession(SESSION_VALUE.get()),
}))

export const ChatApi = webSocketSchema(ChatContract)
    .path("ws/chat")
    .use(SESSION)                   // read + verify the session cookie off the upgrade
    .connectPermission(CHAT_USE)    // gate the handshake (see Permissions)
    .done()

// compose(): bind the handler once per runtime
SESSION_HANDLER.create()
```

```typescript
// browser client — nothing auth-related to do; the cookie rides the upgrade
const client = ChatApi.createClient({url: ""})   // same-origin
await client.connect()
```

For a purely read-only cookie with no gating, skip `.define()` — an ambient `GGCookie`
lands the value in the wire and you read `SESSION.get()` in the handler.

**Read-only on WS, by construction.** There is no `Set-Cookie` on a WebSocket — cookies
are minted on HTTP login/refresh and ride the upgrade. So a `GGCookie` wire on a WS schema
only *reads*; there is no `.updatesCookie` / write-gate (those are `GGRpc.*` HTTP route
concepts).

**The in-band handshake can't spoof it.** The cookie is read only from the real upgrade
request headers, never from the client-authored in-band handshake message — so a client
can't forge another user's session by putting a `cookie` in the handshake payload.

**Identity is pinned at connect.** The cookie is read once at handshake; scopes resolve
once and are cached for the connection's life (see Permissions → "Revocation, accepted
limitation"). There is no mid-session cookie re-read or token refresh over the socket.
Clearing the cookie via HTTP logout fails *new* connects but leaves live sockets open —
close them server-side if you need a hard logout.

**Node clients** keep using bearer tokens / discovery; cookie auth on the upgrade is a
browser concern and is not sent by the Node client.

## Server Setup

### Connection Handler

The server receives `incoming` and `outgoing` typed interfaces for each connection:

```typescript
import { WebSocketIncoming, WebSocketOutgoing } from "@grest-ts/websocket"

export class ChatService {
    private connections = new Map<string, Set<WebSocketOutgoing<typeof ChatContract.methods.serverToClient>>>()

    handleConnection = (
        incoming: WebSocketIncoming<typeof ChatContract.methods.clientToServer>,
        outgoing: WebSocketOutgoing<typeof ChatContract.methods.serverToClient>
    ): void => {
        const user = USER_DATA.get()   // durable principal minted by the wire at handshake

        // Track connection
        if (!this.connections.has(user.userId)) {
            this.connections.set(user.userId, new Set())
        }
        this.connections.get(user.userId)!.add(outgoing)

        // Handle client-to-server messages
        incoming.on({
            sendMessage: async (request) => {
                const message = await this.saveMessage(request, user.userId)
                this.broadcast(request.channelId, message)
                return { success: true, messageId: message.id }
            },
            markAsRead: async ({ messageId }) => {
                await this.markRead(messageId, user.userId)
            },
            ping: async () => {
                // No-op, keeps connection alive
            }
        })

        // Handle disconnect
        outgoing.onClose(() => {
            this.connections.get(user.userId)?.delete(outgoing)
        })
    }

    // Push messages to connected clients
    broadcast(channelId: string, message: Message): void {
        for (const [userId, conns] of this.connections) {
            conns.forEach(conn => conn.newMessage(message))
        }
    }

    notifyTyping(userId: string, channelId: string): void {
        for (const [uid, conns] of this.connections) {
            if (uid !== userId) {
                conns.forEach(conn => conn.typing({ userId, channelId }))
            }
        }
    }
}
```

### Registering the WebSocket Server

#### Using register() (Recommended)

```typescript
import { GGHttp, GGHttpServer } from "@grest-ts/http"

protected compose(): void {
    const httpServer = new GGHttpServer()

    // HTTP APIs
    new GGHttp(httpServer)
        .http(PublicApi, publicService)

    // WebSocket API on the same HTTP server
    ChatApi.register(chatService.handleConnection, { http: httpServer })
}
```

#### Using startServer() (Direct)

```typescript
const socketServer = ChatApi.startServer(chatService.handleConnection, {
    http: httpServer,
    middlewares: [additionalMiddleware]  // Optional extra middlewares
})
```

### Multiple WebSocket APIs

```typescript
protected compose(): void {
    const httpServer = new GGHttpServer()

    // Multiple WebSocket APIs on the same server
    ChatApi.register(chatService.handleConnection, { http: httpServer })
    NotificationApi.register(notificationService.handleConnection, { http: httpServer })
    PresenceApi.register(presenceService.handleConnection, { http: httpServer })
}
```

## Client

### Typed Client via `createClient()`

`ChatApi.createClient()` returns a typed, contract-validated client. It mirrors the server's connection handler: `incoming.on(handlers)` for `serverToClient` messages, `outgoing.method(data)` for `clientToServer` methods.

```typescript
import { ChatApi } from "./ChatApi"

// Create the client (disconnected)
const client = ChatApi.createClient({ url: "ws://localhost:3000" })

// Register handlers for serverToClient messages — Partial, only what you need
client.incoming.on({
    newMessage: (message) => {
        console.log("New message:", message)
    },
    typing: (event) => {
        console.log(event.userId, "is typing")
    },
    // Server-requests-client RPC (has `success` in contract) — return a value
    areYouThere: async () => true
})

// Lifecycle callbacks can be registered before connect
client.onClose(() => console.log("Disconnected"))
client.onError((err) => console.error("Socket error:", err))

// Establish the connection (runs handshake + applies pending handlers)
await client.connect()

// Call clientToServer methods — returns GGPromise like the HTTP client
const response = await client.outgoing.sendMessage({
    text: "Hello!",
    channelId: "general"
})
// response is typed: { success: true, messageId: "msg-456" }

// Fire-and-forget methods (no `success` in contract) — returns Promise<void>
await client.outgoing.markAsRead({ messageId: "msg-123" })
await client.outgoing.ping()

// Error handling — same GGPromise API as the HTTP client
const result = await client.outgoing.sendMessage({ text: "", channelId: "general" }).asResult()
if (result.success) {
    console.log(result.data.messageId)
} else if (result.type === "VALIDATION_ERROR") {
    showValidationErrors(result.data)
}

// Gracefully close (waits for pending requests), or close() for immediate termination
await client.disconnect()
```

### Client Config

```typescript
interface GGWebSocketClientConfig<TQuery> {
    url?: string       // "ws://host:port". If omitted, uses @grest-ts/discovery.
    query?: TQuery     // Query params on connect, typed from `.queryOnConnect<T>()`.
}
```

Omitting `url` triggers service discovery via `@grest-ts/discovery` (Node only). In browsers, pass an explicit URL (use `""` for same-origin).

### Sending Modes (automatic from the contract)

- **Request-response** — methods with `success` defined return `GGPromise<Success, Errors>`. The client sends a `REQ` and waits up to 30s for a reply.
- **Fire-and-forget** — methods without `success` return `GGPromise<void, SERVER_ERROR>`. The client sends a `MSG` and resolves as soon as the message is handed to the socket.

Both apply symmetrically: the server can also send request-response messages via `serverToClient` methods that define `success`.

### Direct socket access via `GGSocketPool`

If you need to bypass contract validation (e.g. writing a generic proxy, debugging the wire protocol), `GGSocketPool` is still available. Prefer `createClient()` in application code.

```typescript
import { GGSocketPool } from "@grest-ts/websocket"

const socket = await GGSocketPool.getOrConnect({
    domain: "ws://localhost:3000",
    path: "/ws/chat",
    middlewares: ChatApi.middlewares
})

const result = await socket.send("ChatApi.sendMessage", { text: "Hello!", channelId: "general" }, true)
socket.registerHandler({ path: "ChatApi.newMessage", handler: (msg) => { ... } })
socket.close()
```

### Connection Pool Management

```typescript
// Pool size
GGSocketPool.size          // Active connections
GGSocketPool.pendingSize   // Connections being established

// Close all connections gracefully (waits for pending requests)
await GGSocketPool.closeAll()

// Close all connections immediately
await GGSocketPool.closeAll(false)

// Remove specific connection from pool (does not close it)
GGSocketPool.removeFromPool(key)

// List all connection keys (for debugging)
GGSocketPool.getConnectionKeys()
```

### Query Parameters on Connect

```typescript
const socket = await GGSocketPool.getOrConnect({
    domain: "ws://localhost:3000",
    path: "/ws/chat",
    query: { room: "general", language: "en" },
    middlewares: ChatApi.middlewares
})
// Connects to: ws://localhost:3000/ws/chat?room=general&language=en
```

## Byte-stream sockets

Some sockets aren't an RPC API — a PTY stream, a log tail, a binary stream. Build those by declaring `{ bytes: true }` on the **contract** instead of message maps, then bind with the **same builder** and `.done()`: the connection-level config (`.path` / `.use(WIRE)` / `.queryOnConnect` / `.connectPermission`) is identical, so a byte-stream socket coexists with typed schemas on the same `GGHttpServer`. After the handshake there's no message contract — you own the wire as opaque frames. A byte-stream contract has two client modes:

- **`{ bytes: true }`** — both ends speak grest-ts. Runs the **same handshake** as a typed socket (in-band first-message auth, path dispatch, `queryOnConnect` validation, discovery, reconnect + liveness), then hands you the raw frames. Use it for a Node or browser grest-ts client streaming bytes.
- **`{ bytes: true, customClient: true, protocols? }`** — for a **foreign client** (noVNC, an editor webview) that can't speak the grest-ts handshake. Auth runs against the HTTP upgrade only (cookie / `?query=`); there is no in-band handshake, no `HANDSHAKE_OK`, and **no grest-ts client** — the foreign client connects with its own library. `protocols` is optional.

```typescript
// raw contract (no message map — just the byte-stream mode), bound + finalized with .done()
export const PtyStream = webSocketSchema(defineSocketContract("Pty", { bytes: true }))
    .path("ws/pty")
    .use(USER_TOKEN_WIRE)                       // same wire/auth as a typed socket
    .queryOnConnect(IsObject({ vmId: IsString }))
    .connectPermission(PtyPermission.ATTACH)    // optional handshake gate
    .done()

// server — handler runs after auth; UserContext.get() is available here
PtyStream.register((socket, query) => {     // socket: send(bytes|string) / onMessage(Buffer) / onClose / close
    const pty = spawn(query.vmId)
    socket.onMessage((data) => pty.write(data))
    pty.onData((data) => socket.send(data))
    socket.onClose(() => pty.kill())
}, { http: httpServer })

// client (node or browser) — connect() resolves void once the handshake auth passes;
// the byte methods live on the client itself.
const pty = PtyStream.createClient({ url: "", query: { vmId } })
await pty.connect()
pty.onMessage((bytes) => term.write(bytes))
pty.send(input)
```

The client must let `connect()` resolve before streaming — frames sent before `HANDSHAKE_OK` are dropped, never delivered pre-auth. (For a socket you hand-roll *entirely* outside this schema, see `GGServerLiveness` / `GGClientLiveness` under Liveness.)

### Byte-stream client surface

`schema.createClient(config)` on a `{ bytes: true }` schema returns a client whose `connect()` resolves `void` (there is no separate connection object — the byte methods are on the client):

- `client.send(bytes)` — send an opaque frame (throws if called before `connect()`)
- `client.onMessage(cb)` — register an inbound-frame handler; persists across reconnects
- `client.onClose(cb)` / `client.disconnect()` / `client.close()` — lifecycle
- `client.onDisconnect(cb)` — fires on every socket drop, before any reconnect attempt
- `client.onError(cb)`, `client.forceReconnect()`, `client.isConnected`

A reconnected byte stream is a **fresh** stream — bytes sent while it was down are not replayed.

### `{ customClient: true }` — foreign clients

A `{ bytes: true, customClient: true, protocols? }` contract has **no grest-ts client** — the foreign client connects with its own WebSocket library, authenticating via the upgrade. Because a foreign client never sends the in-band handshake, `.done()` enforces an invariant **at build time**: it throws if any `.use()`'d wire delivers its credential in-band (a wire with an `update()` writer, e.g. `GGHeader`), since that credential could never arrive. Only upgrade-readable credentials (a cookie or `?query=`) are legal with a customClient contract.

```typescript
export const Desktop = webSocketSchema(defineSocketContract("Desktop", { bytes: true, customClient: true, protocols: ["binary"] }))
    .path("ws/desktop")
    .use(DESKTOP_TOKEN_QUERY)               // upgrade-readable credential (cookie / ?query=)
    .done()                                 // protocols optional; no grest-ts client
```

## Message Protocol

Under the hood, WebSocket communication uses a lightweight text-based protocol:

| Type | Code | Description |
|------|------|-------------|
| `HANDSHAKE` | `h` | Client sends headers during connection |
| `HANDSHAKE_OK` | `k` | Server confirms connection |
| `HANDSHAKE_ERR` | `x` | Server rejects connection |
| `MSG` | `m` | Fire-and-forget message |
| `REQ` | `r` | Request expecting a response |
| `RES` | `s` | Response to a request |

Messages are serialized as: `type:path:id:jsonData`

## Error Handling

### Contract Errors

Declare expected errors in the contract — they're type-checked on both sides:

```typescript
import { ERROR, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema"

const ROOM_FULL = ERROR.define("ROOM_FULL", 400)

export const RoomContract = defineSocketContract("Room", {
    clientToServer: {
        joinRoom: {
            input: IsObject({ roomId: IsString }),
            success: IsObject({ joined: IsBoolean }),
            errors: [ROOM_FULL, NOT_FOUND, SERVER_ERROR]
        }
    },
    serverToClient: {}
})

export const ChatApi = webSocketSchema(RoomContract).path("ws/chat").done()
```

### Throwing Errors in Handlers

```typescript
incoming.on({
    joinRoom: async ({ roomId }) => {
        const room = await findRoom(roomId)
        if (!room) throw new NOT_FOUND()
        if (room.isFull) throw new ROOM_FULL()
        return { joined: true }
    }
})
```

### Connection Rejection

Middleware errors during handshake reject the connection with a `HANDSHAKE_ERR` message and close code `4001`.

## Context Keys

The package provides context keys for accessing connection and message metadata:

```typescript
import { GG_WS_CONNECTION, GG_WS_MESSAGE } from "@grest-ts/websocket"

// Available during connection lifecycle
const conn = GG_WS_CONNECTION.get()
conn.port  // Server port
conn.path  // WebSocket path

// Available during message handling
const msg = GG_WS_MESSAGE.get()
msg.path   // Message path (e.g. "ChatApi.sendMessage")
```

## Metrics

Built-in metrics via `@grest-ts/metrics`:

```typescript
import { GGWebSocketMetrics } from "@grest-ts/websocket"
```

| Metric | Type | Description |
|--------|------|-------------|
| `connections_active` | Gauge | Active WebSocket connections |
| `connections_total` | Counter | Total connection attempts (with result label) |
| `requests_total` | Counter | Incoming messages handled |
| `request_duration_ms` | Histogram | Incoming message processing duration |
| `out_requests_total` | Counter | Outgoing messages sent |
| `out_request_duration_ms` | Histogram | Outgoing request round-trip duration |

## Liveness (heartbeat & half-open detection)

A WebSocket can go **half-open**: an intermediary (NAT, proxy, load balancer) silently drops
an idle connection, or a laptop sleeps, and neither side gets a close event — the link is dead
but looks open until a manual refresh.

**Schema clients get this for free.** Reconnect defaults **on** (backoff + half-open heartbeat
detection), and liveness rides with it: a missed heartbeat drops the socket and the reconnect loop
self-heals. Pass `reconnect: false` to disable it, or a `GGReconnectConfig` object to tune (e.g.
`reconnect: {heartbeat: ...}`), and force a drop from app code (e.g. on `visibilitychange`) with
`client.forceReconnect()`. Both the typed and raw (`{ bytes: true }`) clients share this
machinery — you don't need anything below for them.

### Raw streaming sockets — `GGServerLiveness` / `GGClientLiveness`

This is for a socket you hand-roll **entirely** outside the framework (a bare `ws` server you set
up yourself). A `{ bytes: true }` schema doesn't need any of it — it gets the server heartbeat for
free, same as a typed schema socket. But if you own the raw `ws` directly, the *mechanism* (ping + reap on
the server, watchdog + reconnect in the client) is still available. The two reusable, payload-agnostic
halves are separate classes — `GGServerLiveness` (Node, exported only from the node entry) and
`GGClientLiveness` (browser-safe, exported from both):

```typescript
// --- Server (Node) ---: protocol ping + reap over a `ws` WebSocketServer.
// Keeps proxy/LB legs warm and terminates clients that stop answering pongs.
import { GGServerLiveness } from "@grest-ts/websocket"
const stop = GGServerLiveness.attach(wss)   // default 30s; returns a teardown fn
// ...on shutdown: stop()

// --- Client (browser) ---: ping + watchdog. You own the wire format (see below); the
// watchdog only acts on the verdict your `isAlive` returns and the tab being visible.
import { GGClientLiveness } from "@grest-ts/websocket"
const stop = GGClientLiveness.attach({
    sendPing: () => ws.send(JSON.stringify({type: "ping"})),
    isAlive:  () => !ws || ws.readyState !== WebSocket.OPEN || Date.now() - lastRxAt <= 60_000,
    onDead:   () => ws.close(),   // your onclose handler drives the reconnect
})
```

**The one piece you must supply: the in-band ping/pong.** A browser can neither initiate nor
observe protocol-level ping/pong frames, so it sends an *application* ping that the server echoes.
That message shape is your protocol, so it can't live in the framework — wire it up once:

```typescript
// Server: echo the app-level ping (alongside GGServerLiveness, which handles protocol pings).
ws.on("message", (data, isBinary) => {
    if (isBinary) return
    try { if (JSON.parse(data.toString()).type === "ping") ws.send(JSON.stringify({type: "pong"})) }
    catch { /* not a control frame */ }
})

// Browser: stamp every inbound frame as proof of life, and learn the peer speaks the protocol.
ws.onmessage = (e) => {
    lastRxAt = Date.now()
    // ...if it's a `pong`, you now know reconnect-on-stale is safe to arm...
}
```

That's the whole recipe: `GGServerLiveness.attach` + `GGClientLiveness.attach` + your ~3-line ping
echo. Everything fiddly (visibility/online gating, throttle-awareness, reap bookkeeping) lives in
the helpers.

## Testing

Import the testkit for integration testing support:

```typescript
import { GGSocketCall } from "@grest-ts/websocket/testkit"
```

The testkit extends `GGWebSocketSchema` with `callOn()` support, providing:
- Type-safe `connect()` / `disconnect()` lifecycle
- Each `clientToServer` method returns a `GGSocketCall` test action
- `mock` object for intercepting `serverToClient` messages

```typescript
const api = callOn(ChatApi)

await api.connect()

// Test client-to-server RPC
await api.sendMessage({ text: "Hello", channelId: "general" })
    .toMatchObject({ success: true })

// Test with expected error
await api.sendMessage({ text: "", channelId: "general" })
    .toBeError(VALIDATION_ERROR)

// Mock server-to-client messages
await api.mock.newMessage
    .toMatchObject({ text: "Hello" })

await api.disconnect()
```
