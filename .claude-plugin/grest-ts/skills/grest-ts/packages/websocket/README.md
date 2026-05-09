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

export const ChatApiContract = defineSocketContract("ChatApi", {
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

export const ChatApi = webSocketSchema(ChatApiContract)
    .path("ws/chat")
    .done()
```

### Contract Method Types

Every method supports two sending modes, determined by the contract shape:

- **Request-response** (has `success`) — the sender waits for a typed reply. Use for RPC-style calls where you need a result or confirmation.
- **Fire-and-forget** (no `success`) — the message is sent without waiting. Use for notifications, events, and one-way signals.

Both modes work in either direction (`clientToServer` and `serverToClient`).

```typescript
defineSocketContract("MyApi", {
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
```

### Schema Builder

The schema builder configures the WebSocket endpoint:

```typescript
export const ChatApi = webSocketSchema(ChatApiContract)
    .path("ws/chat")              // WebSocket endpoint path
    .use(AuthMiddleware)           // Add middleware (can chain multiple)
    .queryOnConnect<{ room: string }>()  // Validate query params on connect
    .done()                        // Finalize the schema
```

## Middleware

WebSocket middleware handles authentication and context during the connection handshake. Unlike HTTP middleware which runs per-request, WebSocket middleware runs once when the connection is established.

### Defining Middleware

```typescript
import { GGWebSocketMiddleware, GGWebSocketHandshakeContext } from "@grest-ts/websocket"
import { GGContextKey } from "@grest-ts/context"
import { IsObject, IsString, NOT_AUTHORIZED } from "@grest-ts/schema"

export const IsUserAuth = IsObject({
    userId: IsString,
    token: IsString
})
export type UserAuth = typeof IsUserAuth.infer

export const GG_USER_AUTH = new GGContextKey<UserAuth>("user_auth", IsUserAuth)

export const AuthMiddleware: GGWebSocketMiddleware = {
    // Client-side: add auth headers to the handshake
    updateHandshake(context: GGWebSocketHandshakeContext): void {
        const auth = GG_USER_AUTH.get()
        if (auth) {
            context.headers["authorization"] = `Bearer ${auth.token}`
        }
    },

    // Server-side: parse auth headers from the handshake
    parseHandshake(context: GGWebSocketHandshakeContext): void {
        const authHeader = context.headers["authorization"]
        if (!authHeader?.startsWith("Bearer ")) {
            throw new NOT_AUTHORIZED()
        }
        GG_USER_AUTH.set({
            userId: "",  // Will be resolved in process()
            token: authHeader.substring(7)
        })
    },

    // Server-side: async processing (validate token, load user, etc.)
    async process(): Promise<void> {
        const auth = GG_USER_AUTH.get()
        const user = await validateToken(auth.token)
        if (!user) throw new NOT_AUTHORIZED()
        GG_USER_AUTH.set({ userId: user.id, token: auth.token })
    }
}
```

### Middleware Interface

```typescript
interface GGWebSocketMiddleware {
    updateHandshake?(context: GGWebSocketHandshakeContext): void  // Client-side
    parseHandshake?(context: GGWebSocketHandshakeContext): void   // Server-side
    process?(): Promise<void>                                     // Server-side async
}
```

All methods are optional — implement only what you need. Throwing an error in `parseHandshake` or `process` rejects the connection.

### Chaining Middleware

```typescript
export const ChatApi = webSocketSchema(ChatApiContract)
    .path("ws/chat")
    .use(AuthMiddleware)
    .use(LocaleMiddleware)
    .use(RateLimitMiddleware)
    .done()
```

Middlewares run in order during connection establishment.

### Sharing middleware with HTTP APIs (one class, two transports)

Most apps are HTTP-first and add WebSockets later. You'll often want the *same* auth logic on both — same bearer-token shape, same verification, same user context key. The two middleware interfaces are deliberately separate (HTTP runs per-request; WS runs once at handshake — see the note below), but TypeScript structural typing lets **one class implement both interfaces** so you write the logic once and attach it to both schemas.

```typescript
import { GGHttpTransportMiddleware, GGHttpRequest } from "@grest-ts/http"
import { GGWebSocketMiddleware, GGWebSocketHandshakeContext } from "@grest-ts/websocket"
import { GGContextKey } from "@grest-ts/context"
import { IsObject, IsString, NOT_AUTHORIZED } from "@grest-ts/schema"

export const IsAuthUser = IsObject({ id: IsString, role: IsString })
export type AuthUser = typeof IsAuthUser.infer
export const GG_AUTH_USER = new GGContextKey<AuthUser>("authUser", IsAuthUser)

/**
 * Implements both middleware interfaces. Use the same instance on HTTP and
 * WebSocket schemas — single source of truth for auth wiring.
 */
export class BearerAuthMiddleware
    implements GGHttpTransportMiddleware, GGWebSocketMiddleware {

    constructor(private opts: {
        /** Client-side: return the current token. Called on every HTTP request AND on every WS handshake. */
        getToken: () => string | undefined
        /** Server-side: verify the token and return the user. Throw/return undefined to reject. */
        verify:   (token: string) => AuthUser | undefined
    }) {}

    // ---- Client-side: attach the bearer header ----
    updateRequest   = (req: GGHttpRequest) =>
        this.setHeader(req.headers as Record<string, string>)
    updateHandshake = (ctx: GGWebSocketHandshakeContext) =>
        this.setHeader(ctx.headers)

    // ---- Server-side: extract + verify, populate context ----
    parseRequest    = (req: GGHttpRequest) =>
        this.extract(req.headers as Record<string, string | string[]>)
    parseHandshake  = (ctx: GGWebSocketHandshakeContext) =>
        this.extract(ctx.headers)

    private setHeader(headers: Record<string, string>) {
        const t = this.opts.getToken()
        if (t) headers["authorization"] = "Bearer " + t
    }
    private extract(headers: Record<string, string | string[]>) {
        const header = headers["authorization"]
        if (typeof header !== "string" || !header.startsWith("Bearer ")) {
            throw new NOT_AUTHORIZED({ displayMessage: "Missing bearer token" })
        }
        const user = this.opts.verify(header.substring(7))
        if (!user) throw new NOT_AUTHORIZED({ displayMessage: "Invalid token" })
        GG_AUTH_USER.set(user)
    }
}

// One instance, used on both kinds of schema:
const auth = new BearerAuthMiddleware({
    getToken: () => GG_AUTH_USER.get()?.id,
    verify:   (token) => validateTokenSync(token),
})

export const ItemApi = httpSchema(ItemContract).pathPrefix("api/items")
    .use(auth)           // acts as GGHttpTransportMiddleware
    .routes({ ... })

export const ChatApi = webSocketSchema(ChatContract).path("ws/chat")
    .use(auth)           // acts as GGWebSocketMiddleware
    .done()
```

**Important — the rhythms are different:**

| | HTTP | WebSocket |
|---|---|---|
| When middleware runs | Per request | Once, at handshake |
| What it can do        | Modify each request/response    | Set connection-scoped context |
| Token refresh         | Naturally handled: next request reads the new token | Not automatic — token is captured at connect time. If the token rotates mid-session, the old connection keeps its old identity until it's dropped and a fresh handshake runs |

This is why the interfaces aren't merged: forcing a single interface would make WS middleware silently not re-run on messages (a foot-gun). Keep the rhythms distinct and share *logic*, not *lifecycle*.

The server-side extraction logic here is identical for both transports — that's the common case and the reason this pattern pays off. If your HTTP flow needs per-request behavior that doesn't map to WS (say, modifying the HTTP response body), put those hooks on a separate HTTP-only middleware and apply both.

## Server Setup

### Connection Handler

The server receives `incoming` and `outgoing` typed interfaces for each connection:

```typescript
import { WebSocketIncoming, WebSocketOutgoing } from "@grest-ts/websocket"

export class ChatService {
    private connections = new Map<string, Set<WebSocketOutgoing<typeof ChatApiContract.methods.serverToClient>>>()

    handleConnection = (
        incoming: WebSocketIncoming<typeof ChatApiContract.methods.clientToServer>,
        outgoing: WebSocketOutgoing<typeof ChatApiContract.methods.serverToClient>
    ): void => {
        const user = GG_USER_AUTH.get()

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

export const ChatApiContract = defineSocketContract("ChatApi", {
    clientToServer: {
        joinRoom: {
            input: IsObject({ roomId: IsString }),
            success: IsObject({ joined: IsBoolean }),
            errors: [ROOM_FULL, NOT_FOUND, SERVER_ERROR]
        }
    },
    serverToClient: {}
})
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
