<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# WebSocket Package Usage (@grest-ts/websocket)

How to use the WebSocket package for building type-safe, bidirectional WebSocket APIs.

## WebSocket API Definition

### Defining a Contract

A `GGDuplexContract` declares a typed two-way channel. Three method maps:
- `connect` — the handshake itself (see "The `connect` method")
- `clientToServer` — methods the client calls on the server (RPC-style)
- `serverToClient` — messages the server pushes to the client

```typescript
// ChatApi.ts
import {GGWebSocketSchema} from "@grest-ts/websocket"
import {
    GGDuplexContract, IsObject, IsString, IsBoolean, IsUint,
    SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS,
} from "@grest-ts/schema"

export const IsUserId = IsString.brand("UserId")
export type tUserId = typeof IsUserId.infer

export const IsMessage = IsObject({
    id: IsString,
    text: IsString,
    senderId: IsUserId,
    timestamp: IsUint,
})
export type Message = typeof IsMessage.infer

export const IsSendMessageRequest = IsObject({text: IsString.nonEmpty, channelId: IsString})
export const IsSendMessageResponse = IsObject({success: IsBoolean, messageId: IsString})
export const IsTypingEvent = IsObject({userId: IsUserId, channelId: IsString})

export const ChatContract = new GGDuplexContract("Chat", {
    // Public socket → connect can only fail with SERVER_ERROR.
    connect: {errors: [SERVER_ERROR]},
    clientToServer: {
        // Request-response: client sends a request, server returns a typed reply.
        sendMessage: {
            input: IsSendMessageRequest,
            success: IsSendMessageResponse,
            errors: [VALIDATION_ERROR, SERVER_ERROR],
            permission: GG_NO_PERMISSIONS,
        },
        // Fire-and-forget: no response expected.
        markAsRead: {input: IsObject({messageId: IsString}), permission: GG_NO_PERMISSIONS},
        ping: {permission: GG_NO_PERMISSIONS},
    },
    serverToClient: {
        // Server push.
        newMessage: {input: IsMessage, permission: GG_NO_PERMISSIONS},
        typing: {input: IsTypingEvent, permission: GG_NO_PERMISSIONS},
        // Server-requests-client RPC (has `success`).
        areYouThere: {success: IsBoolean, errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS},
    },
})

export const ChatApi = new GGWebSocketSchema({contract: ChatContract, path: "ws/chat"})
```

**Important:** `new GGDuplexContract(name, {connect, clientToServer, serverToClient})` — first arg is the name, second is the method maps. Every `clientToServer`/`serverToClient` method carries a `permission` (use `GG_NO_PERMISSIONS` when ungated — see "Permissions").

### Contract Method Types

Every method supports two sending modes, determined by the contract shape:

- **Request-response** (has `success`) — the sender waits for a typed reply. Use for RPC-style calls.
- **Fire-and-forget** (no `success`) — sent without waiting. Use for notifications and one-way signals.

Both modes work in either direction (`clientToServer` and `serverToClient`).

```typescript
const MyContract = new GGDuplexContract("My", {
    connect: {errors: [SERVER_ERROR]},
    clientToServer: {
        // Request-response: input + success + errors
        update: {input: IsUpdateRequest, success: IsUpdateResponse, errors: [VALIDATION_ERROR, SERVER_ERROR], permission: GG_NO_PERMISSIONS},
        // Fire-and-forget with data: input only
        notify: {input: IsNotifyRequest, permission: GG_NO_PERMISSIONS},
        // Fire-and-forget without data
        ping: {permission: GG_NO_PERMISSIONS},
    },
    serverToClient: {},
})

export const MyApi = new GGWebSocketSchema({contract: MyContract, path: "ws/my"})
```

### The `connect` method

`connect` is a first-class contract method describing the handshake. Three optional fields:

```typescript
connect: {
    input: IsObject({room: IsString}),   // handshake query schema — validated both ends
    permission: ChatPermission.USE,      // connection-level gate (resolved once at handshake)
    errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
}
```

**Important — `connect.errors` convention:**
- Public socket (no auth) → `[SERVER_ERROR]`.
- Authenticated (a `use:[wire]` whose `process()` can reject) → `[NOT_AUTHORIZED, SERVER_ERROR]`.
- Has a `connect.permission` → also include `FORBIDDEN`.

`connect.input` is the typed handshake query: the connection handler receives the validated query as its 3rd argument, and `createClient({query})` is typed from it. `connect.permission` gates the whole connection — failure closes the socket before any message.

### Schema

`new GGWebSocketSchema({contract, path, use?})` binds the contract to an endpoint. `use` (optional) attaches credential wires / middleware — same wire model as HTTP.

```typescript
export const ChatApi = new GGWebSocketSchema({
    contract: ChatContract,
    path: "ws/chat",                 // WebSocket endpoint path
    use: [USER_TOKEN_WIRE],          // attach a credential wire (verified at handshake)
})
```

### Extendable schemas (one socket, many modules)

When several feature modules should share a single connection but stay decoupled (each owning its own events, no central registry), declare the connection once with `GGDuplexExtendableContract` + `GGWebSocketExtendableSchema`, then let each module `extend` it from its own file. Extensions of the same anchor multiplex over **one physical socket** (the path is registered once); `extend` only accepts a contract created from that anchor's contract, and duplicate module names throw.

```typescript
// chat.ts — the connection, declared once
export const ChatContract = new GGDuplexExtendableContract("Chat", {connect: {input: IsChatQuery, errors: [SERVER_ERROR]}})
export const ChatSocket = new GGWebSocketExtendableSchema({contract: ChatContract, path: "ws/chat", use: [USER_TOKEN_WIRE]})

// messaging.ts — a module; path/use/connect are inherited
export const Messaging = ChatContract.extend("Messaging", {
    clientToServer: {send: {input: IsMsg, success: IsAck, errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS}},
    serverToClient: {message: {input: IsMsg}},
})
export const MessagingSocket = ChatSocket.extend(Messaging)
```

`MessagingSocket` is an ordinary `GGWebSocketSchema` — bind it with `.ws(MessagingSocket, handler)` and consume it with `MessagingSocket.createClient()` exactly as usual; sibling modules registered on the same anchor share the path.

## Permissions

`clientToServer` methods declare a `permission`; the gate runs **per incoming message**, before the handler. `serverToClient` methods are server-originated — set `GG_NO_PERMISSIONS` (the gate ignores it). The opt-in / infectious rule from HTTP applies: any non-`GG_NO_PERMISSIONS` c2s permission, or a `connect.permission`, on any WS schema registered on the same `GGHttpServer` triggers strict mode for the whole server — every HTTP and WS route on it must then declare.

Two gating levels combine:

- **`connect.permission`** (optional) is checked at handshake. Use it where lacking permission means there's no point opening the connection at all. Failure closes the socket immediately.
- **Per-c2s-method `permission`** is checked on every incoming message, against scopes resolved **once** at handshake and cached on the connection. No per-message token re-parsing.

Scopes come from the **wires** the schema `use`s — exactly as on HTTP. The wire's `process()` verifies the credential at handshake and its `permissions()` resolver returns the caller's grants; the schema's wires are the only source of scopes:

```typescript
export const ChatApi = new GGWebSocketSchema({
    contract: ChatContract,          // a clientToServer method declares permission: ChatPermission.USE
    path: "ws/chat",
    use: [USER_TOKEN_WIRE],          // verifies the credential + resolves scopes at handshake
})
```

The refuse-to-start guarantee from HTTP applies: a `use`d wire must be implemented (`.define(...).create(deps)` in `compose()`) or the server fails to start; a permissioned route on a wire-less schema fails closed. The strict-mode trigger is shared with HTTP across the same `GGHttpServer`.

**Revocation, accepted limitation.** Scopes are resolved at handshake and cached for the connection's life. Mid-session revocation does not take effect until the socket closes — the same constraint that applies to bearer tokens generally. Apps needing strong revocation should avoid long-lived sockets on that surface or close affected connections externally.

## Wires & Middleware

Authentication and per-request context ride on **wires** — exactly as on HTTP (see
`@grest-ts/http` → "Authentication & Context"). A wire (`GGHeader` / `GGCookie`) is a context
key and a transport middleware at once; attach it with `use:[WIRE]` on the WS schema. On
WebSocket the wire resolves **once at the connection handshake** (HTTP, by contrast, resolves
per request). A credential wire's `process()` verifies the credential off the upgrade and
mints a durable principal; per-message permission gates read scopes cached at handshake.

### Auth wire (the common case)

The wire and its identity types live in the shared `api/`; the verification handler and the
durable principal live server-side. This is the **same** `USER_TOKEN_WIRE` an HTTP schema
uses — one declaration, both transports.

```typescript
// api/auth/UserAuth.ts  (shared)
import {GGHeader} from "@grest-ts/http"
export const USER_TOKEN_WIRE = new GGHeader("authorization", {scheme: "bearer"})
```

```typescript
// server/auth/UserAuthHandler.ts  (server-only) — runs once at handshake
import {GGContextKey} from "@grest-ts/context"
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {IsUser, USER_TOKEN_WIRE} from "../../api/auth/UserAuth"

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
export const ChatApi = new GGWebSocketSchema({
    contract: ChatContract,
    path: "ws/chat",
    use: [USER_TOKEN_WIRE],          // verified at handshake
})

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

All methods are optional — implement only what you need. Throwing in `parse` or `process` rejects the connection. `respond` is an HTTP-only hook — never called on WebSocket, which has no response-header stage.

A middleware (and a `GGCookie` wire) reads the cookie via `inbound.cookie`, not `inbound.headers`. On WebSocket the runtime fills `inbound.cookie` from the real HTTP upgrade request; the in-band handshake message can never set it, so it can't be spoofed.

A `GGTransportMiddleware` instance goes straight into `use`:

```typescript
export const AuthedSocketApi = new GGWebSocketSchema({
    contract: AuthedSocketApiContract,
    path: "ws/authed-test",
    use: [AuthedSocketMiddleware],   // a plain GGTransportMiddleware object
})
```

### Chaining

```typescript
export const ChatApi = new GGWebSocketSchema({
    contract: ChatContract,
    path: "ws/chat",
    use: [USER_TOKEN_WIRE, LocaleMiddleware],   // credential wire + ambient middleware, resolved in order
})
```

Wires/middleware resolve in order during connection establishment.

### One wire, two transports

Most apps are HTTP-first and add WebSockets later, and want the *same* auth on both. Because
a wire is the single source of truth, you `use` the **same wire instance** on both kinds of
schema — and `.create()` its handler once. There is nothing protocol-specific to keep in sync.

```typescript
export const ItemApi = new GGHttpSchema({
    contract: ItemContract,
    pathPrefix: "api/items",
    use: [USER_TOKEN_WIRE],
    routes: {/* ... */},
})

export const ChatApi = new GGWebSocketSchema({
    contract: ChatContract,
    path: "ws/chat",
    use: [USER_TOKEN_WIRE],
})
```

The wire's `process()` runs on whichever transport is in play; the durable principal it mints
reads the same in both. Sharing the wire shares *logic* — the *lifecycles* still differ:

**Important — the lifecycles still differ:**

| | HTTP | WebSocket |
|---|---|---|
| When middleware runs | Per request | Once, at handshake |
| What it can do        | Modify each request/response    | Set connection-scoped context |
| Token refresh         | Naturally handled: next request reads the new token | Not automatic — token is captured at connect time. If the token rotates mid-session, the old connection keeps its old identity until it's dropped and a fresh handshake runs |

Connection-scoped context (identity, scopes) is pinned at handshake and does not re-run per message. An HTTP-only hook like `respond` (e.g. writing a `Set-Cookie`) is simply never invoked on the WebSocket side.

## Cookies (httpOnly sessions, read-only)

If your app authenticates over HTTP with an httpOnly session cookie (see
`@grest-ts/http` → "Cookies"), that **same cookie authenticates the socket** with no
client code: a browser auto-attaches the cookie to the WebSocket upgrade request (it
can't put an httpOnly cookie into the in-band handshake — JS can't read it). `use` a
`GGCookie` wire on the WS schema and read it identically to HTTP.

To turn the cookie into scopes / identity at handshake, `.define()` the cookie wire
(server-side) so its `process()` verifies the session and its `permissions()` resolves
scopes — the same smart-wire model as a token wire, just over a cookie:

```typescript
import {GGCookie} from "@grest-ts/http"
import {GGWebSocketSchema} from "@grest-ts/websocket"
import {GGContextKey} from "@grest-ts/context"
import {GGDuplexContract, NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR, IsString, GG_NO_PERMISSIONS} from "@grest-ts/schema"

// A GGCookie wire over the "session" cookie, required-or-throw.
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

export const ChatApi = new GGWebSocketSchema({
    contract: new GGDuplexContract("Chat", {
        // process() can 401, connect.permission can 403 → both errors listed.
        connect: {permission: CHAT_USE, errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR]},
        clientToServer: {/* ... */},
        serverToClient: {},
    }),
    path: "ws/chat",
    use: [SESSION],                  // read + verify the session cookie off the upgrade
})

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
only *reads*; there is no write-gate.

**The in-band handshake can't spoof it.** The cookie is read only from the real upgrade
request headers, never from the client-authored handshake message.

**Identity is pinned at connect.** The cookie is read once at handshake; scopes resolve
once and are cached for the connection's life (see Permissions → "Revocation"). Clearing the
cookie via HTTP logout fails *new* connects but leaves live sockets open — close them
server-side if you need a hard logout.

**Node clients** keep using bearer tokens / discovery; cookie auth on the upgrade is a
browser concern and is not sent by the Node client.

## Server Setup

### Connection Handler

The handler types come **straight off the schema** — already wrapped. Don't import or wrap
`WebSocketIncoming` / `WebSocketOutgoing` in app code:

```typescript
type ChatIncoming = typeof ChatApi.clientToServer   // WebSocketIncoming<...> — call .on({...})
type ChatOutgoing = typeof ChatApi.serverToClient   // WebSocketOutgoing<...> — server-push methods + onClose
```

The server receives `incoming` and `outgoing` for each connection (and the validated
`connect.input` query as a 3rd arg, when declared):

```typescript
import {ChatApi, Message} from "./ChatApi"
import {USER_DATA} from "./auth/UserAuthHandler"

export class ChatService {
    private connections = new Map<string, Set<typeof ChatApi.serverToClient>>()

    handleConnection = (incoming: typeof ChatApi.clientToServer, outgoing: typeof ChatApi.serverToClient): void => {
        const user = USER_DATA.get()   // durable principal minted by the wire at handshake

        if (!this.connections.has(user.userId)) this.connections.set(user.userId, new Set())
        this.connections.get(user.userId)!.add(outgoing)

        incoming.on({
            sendMessage: async (request) => {
                const message = await this.saveMessage(request, user.userId)
                this.broadcast(request.channelId, message)
                return {success: true, messageId: message.id}
            },
            markAsRead: async ({messageId}) => {
                await this.markRead(messageId, user.userId)
            },
            ping: async () => {},
        })

        outgoing.onClose(() => {
            this.connections.get(user.userId)?.delete(outgoing)
        })
    }

    broadcast(channelId: string, message: Message): void {
        for (const [, conns] of this.connections) conns.forEach(conn => conn.newMessage(message))
    }

    notifyTyping(userId: string, channelId: string): void {
        for (const [uid, conns] of this.connections) {
            if (uid !== userId) conns.forEach(conn => conn.typing({userId, channelId}))
        }
    }
}
```

When the contract declares `connect.input`, the validated query arrives as the handler's 3rd argument:

```typescript
handleConnection = (incoming: typeof QuerySocketApi.clientToServer, outgoing: typeof QuerySocketApi.serverToClient, query: QueryArgs): void => {
    incoming.on({echoRoom: async () => `${query.room}@${query.version}`})
}
```

### Registering the WebSocket Server

Register WS schemas on a `GGHttpServer` via `GGHttp.ws(schema, handler)` — alongside HTTP
APIs on the same server:

```typescript
import {GGHttp, GGHttpServer} from "@grest-ts/http"

protected compose(): void {
    const httpServer = new GGHttpServer()

    new GGHttp(httpServer)
        .http(PublicApi, publicService)
        .ws(ChatApi, chatService.handleConnection)
        .ws(NotificationApi, notificationService.handleConnection)
        .ws(PresenceApi, presenceService.handleConnection)
}
```

`.wsRaw(schema, handler)` registers byte-stream sockets (see "Byte-stream sockets"). Both
chain off the same `GGHttp` instance as `.http(...)`.

## Client

### Typed Client via `createClient()`

`ChatApi.createClient()` returns a typed, contract-validated client. It mirrors the server's connection handler: `incoming.on(handlers)` for `serverToClient` messages, `outgoing.method(data)` for `clientToServer` methods.

```typescript
import {ChatApi} from "./ChatApi"

const client = ChatApi.createClient({url: "ws://localhost:3000"})

// Register handlers for serverToClient messages — Partial, only what you need
client.incoming.on({
    newMessage: (message) => console.log("New message:", message),
    typing: (event) => console.log(event.userId, "is typing"),
    // Server-requests-client RPC (has `success`) — return a value
    areYouThere: async () => true,
})

client.onClose(() => console.log("Disconnected"))
client.onError((err) => console.error("Socket error:", err))

// Establish the connection (runs handshake + applies pending handlers)
await client.connect()

// Call clientToServer methods — returns GGPromise like the HTTP client
const response = await client.outgoing.sendMessage({text: "Hello!", channelId: "general"})
// response is typed: { success: true, messageId: "msg-456" }

// Fire-and-forget methods (no `success`) — returns Promise<void>
await client.outgoing.markAsRead({messageId: "msg-123"})
await client.outgoing.ping()

// Error handling — same GGPromise API as the HTTP client
const result = await client.outgoing.sendMessage({text: "", channelId: "general"}).asResult()
if (result.success) {
    console.log(result.data.messageId)
} else if (result.type === "VALIDATION_ERROR") {
    showValidationErrors(result.data)
}

// Gracefully close (waits for pending requests), or close() for immediate termination
await client.disconnect()
```

`connect()` also accepts a setup callback (re-run on every reconnect) to wire handlers:

```typescript
await client.connect(({incoming}) => incoming.on({newMessage: (m) => render(m)}))
```

### Client Config

```typescript
interface GGWebSocketClientConfig<TQuery> {
    url?: string       // "ws://host:port". If omitted, uses @grest-ts/discovery.
    query?: TQuery     // Handshake query, typed from the contract's connect.input.
}
```

Omitting `url` triggers service discovery via `@grest-ts/discovery` (Node only). In browsers, pass an explicit URL (use `""` for same-origin).

### `beforeConnect` — rotating credentials

`url` / `query` / `middlewares` in the config are captured once, so a **short-lived / rotating credential** (a per-connection minted token, a `?token=` query, a signed URL) goes stale and built-in reconnect re-handshakes with a dead value. `beforeConnect` resolves the volatile params *inside* the connect path, so it runs on the first connect **and every reconnect** — never stale:

```typescript
const client = EventsApi.createClient({
    reconnect: true,
    beforeConnect: async () => {
        const a = await mintAccess()                  // fresh short-lived token (+ endpoint)
        return {url: a.url, query: {token: a.token}}
    },
})
await client.connect(({incoming}) => incoming.on({onEvent: async (e) => handle(e)}))
```

- **Sole source (type-enforced):** connection params come from *either* the static `url`/`query`/`middlewares` *or* `beforeConnect` — never both. The config is a discriminated union, so setting a static field alongside `beforeConnect` is a **compile error**. `beforeConnect` returns the complete set each attempt; schema `use` wires always apply on top.
- **Validated every attempt:** the returned `query` is validated each connect; a `VALIDATION_ERROR` is **terminal** (won't retry — a malformed query won't fix itself).
- **Errors:** on a reconnect, a throw feeds `shouldRetry` (transient mint failure → backoff; `NOT_AUTHORIZED` / `FORBIDDEN` / `VALIDATION_ERROR` → final `onClose("unrecoverable")`). On the first connect, a throw rejects `connect()`.
- Available on both the typed and raw `createClient`. No reconnect loop or token-refresh plumbing in app code.

### Sending Modes (automatic from the contract)

- **Request-response** — methods with `success` return `GGPromise<Success, Errors>`. The client sends a `REQ` and waits up to 30s for a reply.
- **Fire-and-forget** — methods without `success` return `GGPromise<void, SERVER_ERROR>`. The client sends a `MSG` and resolves as soon as the message is handed to the socket.

Both apply symmetrically: the server can also send request-response messages via `serverToClient` methods that define `success`.

## Byte-stream sockets

Some sockets aren't an RPC API — a PTY stream, a log tail, a binary stream. Build those with
`GGRawSocketContract` + `GGRawWebSocketSchema`, registered via `.wsRaw(...)`. The
connection-level config (`path`, `use`, `connect`) is identical to a typed socket, so a
byte-stream socket coexists with typed schemas on the same `GGHttpServer`. After the handshake
there's no message contract — you own the wire as opaque frames. Two client modes:

- **default** — both ends speak grest-ts. Runs the **same handshake** as a typed socket (in-band first-message auth, path dispatch, `connect.input` validation, discovery, reconnect + liveness), then hands you the raw frames. Use it for a Node or browser grest-ts client streaming bytes.
- **`customClient: true`** — for a **foreign client** (noVNC, an editor webview) that can't speak the grest-ts handshake. Auth runs against the HTTP upgrade only (cookie / `?query=`); there is no in-band handshake, no `HANDSHAKE_OK`, and **no grest-ts client**. `protocols` is optional.

```typescript
import {GGRawWebSocketSchema} from "@grest-ts/websocket"
import {GGRawSocketContract, IsObject, IsString, NOT_AUTHORIZED, SERVER_ERROR} from "@grest-ts/schema"

export const PtyContract = new GGRawSocketContract("Pty", {
    connect: {
        input: IsObject({vmId: IsString}),   // same connect.input as a typed socket
        errors: [NOT_AUTHORIZED, SERVER_ERROR],
    },
})

export const PtyApi = new GGRawWebSocketSchema({
    contract: PtyContract,
    path: "ws/pty",
    use: [USER_TOKEN_WIRE],                  // same wire/auth as a typed socket
})

// server — handler runs after auth; USER_DATA.get() is available here.
// socket: send(bytes|string) / onMessage((Buffer, isBinary)) / onClose / close
new GGHttp(httpServer).wsRaw(PtyApi, (socket, query, upgrade) => {
    const pty = spawn(query.vmId)
    socket.onMessage((data, isBinary) => pty.write(data))   // isBinary = WS frame type (text vs binary)
    pty.onData((data) => socket.send(data))
    socket.onClose(() => pty.kill())
})

// client (node or browser) — connect() resolves void once handshake auth passes;
// the byte methods live on the client itself.
const pty = PtyApi.createClient({url: "", query: {vmId}})
await pty.connect()
pty.onMessage((bytes) => term.write(bytes))
pty.send(input)
```

The handler's `socket` is a `GGRawSocket` (import the type from `@grest-ts/websocket` for explicit signatures). The client must let `connect()` resolve before streaming — frames sent before `HANDSHAKE_OK` are dropped, never delivered pre-auth.

### Byte-stream client surface

`schema.createClient(config)` on a raw schema returns a client whose `connect()` resolves `void` (the byte methods are on the client itself):

- `client.send(bytes)` — send an opaque frame (throws if called before `connect()`)
- `client.onMessage((bytes, isBinary) => …)` — inbound-frame handler; persists across reconnects
- `client.onClose(cb)` / `client.disconnect()` / `client.close()` — lifecycle
- `client.onDisconnect(cb)` — fires on every socket drop, before any reconnect attempt
- `client.onError(cb)`, `client.forceReconnect()`, `client.isConnected`

A reconnected byte stream is a **fresh** stream — bytes sent while it was down are not replayed.

### `customClient: true` — foreign clients

A `customClient` contract has **no grest-ts client** — the foreign client connects with its own WebSocket library, authenticating via the upgrade. Because a foreign client never sends the in-band handshake, the schema enforces an invariant **at build time**: it throws if any `use`d wire delivers its credential in-band (a wire with an `update()` writer, e.g. `GGHeader`), since that credential could never arrive. Only upgrade-readable credentials (a cookie or `?query=`) are legal.

```typescript
export const DesktopContract = new GGRawSocketContract("Desktop", {
    connect: {errors: [NOT_AUTHORIZED, SERVER_ERROR]},
    customClient: true,
    protocols: ["binary"],          // optional
})

export const DesktopApi = new GGRawWebSocketSchema({
    contract: DesktopContract,
    path: "ws/desktop",
    use: [DESKTOP_TOKEN_QUERY],     // upgrade-readable credential (cookie / ?query=)
})
```

#### Wildcard prefix paths + the upgrade

A foreign app often opens its socket at a **dynamic subpath** (code-server connects somewhere under `/code-server/…`). A trailing `/*` makes the path a prefix — it matches the base and anything beneath it (`/code-server` and `/code-server/…`, but not `/code-serverX`). Wildcard paths are **customClient-only** (a typed or default-raw socket has a grest-ts client that needs one exact URL). Exact paths always win over prefixes; among prefixes the longest match wins.

The handler's third argument is the `GGWsUpgrade` — `{path, url, headers, remoteAddress}` — giving the **concrete** request path, headers, and peer address for that connection: a proxy needs the path/headers to route upstream, and `remoteAddress` gates a loopback-only endpoint (`remoteAddress ∈ 127.0.0.1 / ::1`):

```typescript
export const CodeServerContract = new GGRawSocketContract("CodeServer", {
    connect: {errors: [SERVER_ERROR]},
    customClient: true,
    protocols: ["binary"],
})

export const CodeServerApi = new GGRawWebSocketSchema({
    contract: CodeServerContract,
    path: "/code-server/*",
    use: [RELAY_TOKEN_QUERY],
})

new GGHttp(httpServer).wsRaw(CodeServerApi, (socket, _query, upgrade) => {
    const upstreamPath = upgrade.path.slice("/code-server".length)   // upgrade.path = "/code-server/abc/feedback"
    const up = new WebSocket(`ws://127.0.0.1:8080${upstreamPath}`, {headers: upgrade.headers})
    socket.onMessage((b) => up.send(b))
    up.on("message", (b) => socket.send(b))
    socket.onClose(() => up.close())
})
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
import {ERROR, NOT_FOUND, SERVER_ERROR, GGDuplexContract, IsObject, IsString, IsBoolean, GG_NO_PERMISSIONS} from "@grest-ts/schema"
import {GGWebSocketSchema} from "@grest-ts/websocket"

const ROOM_FULL = ERROR.define("ROOM_FULL", 400)

export const RoomContract = new GGDuplexContract("Room", {
    connect: {errors: [SERVER_ERROR]},
    clientToServer: {
        joinRoom: {
            input: IsObject({roomId: IsString}),
            success: IsObject({joined: IsBoolean}),
            errors: [ROOM_FULL, NOT_FOUND, SERVER_ERROR],
            permission: GG_NO_PERMISSIONS,
        },
    },
    serverToClient: {},
})

export const RoomApi = new GGWebSocketSchema({contract: RoomContract, path: "ws/room"})
```

### Throwing Errors in Handlers

```typescript
incoming.on({
    joinRoom: async ({roomId}) => {
        const room = await findRoom(roomId)
        if (!room) throw new NOT_FOUND()
        if (room.isFull) throw new ROOM_FULL()
        return {joined: true}
    },
})
```

### Connection Rejection

Middleware errors during handshake reject the connection with a `HANDSHAKE_ERR` message and close code `4001`.

## Context Keys

The package provides context keys for accessing connection and message metadata:

```typescript
import {GG_WS_CONNECTION, GG_WS_MESSAGE} from "@grest-ts/websocket"

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
import {GGWebSocketMetrics} from "@grest-ts/websocket"
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
`client.forceReconnect()`. Both the typed and raw clients share this machinery — there is nothing
to wire up.

## Testing

Import the testkit for integration testing support:

```typescript
import {callOn} from "@grest-ts/testkit"
import {GGSocketCall} from "@grest-ts/websocket/testkit"
```

`callOn(ChatApi)` on a WS schema provides:
- Type-safe `connect()` / `disconnect()` lifecycle
- Each `clientToServer` method returns a `GGSocketCall` test action
- `mock` object for intercepting `serverToClient` messages

```typescript
const api = callOn(ChatApi)

await api.connect()

// Test client-to-server RPC
await api.sendMessage({text: "Hello", channelId: "general"})
    .toMatchObject({success: true})

// Test with expected error
await api.sendMessage({text: "", channelId: "general"})
    .toBeError(VALIDATION_ERROR)

// Mock server-to-client messages
await api.mock.newMessage
    .toMatchObject({text: "Hello"})

await api.disconnect()
```
