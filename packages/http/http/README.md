<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# HTTP Package Usage (@grest-ts/http)

How to use the HTTP package for building type-safe HTTP and WebSocket APIs.

## HTTP API Definition

### Basic API Structure

```typescript
// MyApi.ts
import { GGRpc, httpSchema } from "@grest-ts/http"
import { GGContractClass, IsArray, IsObject, IsString, IsBoolean, IsUint, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR } from "@grest-ts/schema"

// ---------------------------------------------------------
// Type Schemas
// ---------------------------------------------------------

export const IsItemId = IsString.brand("ItemId")
export type tItemId = typeof IsItemId.infer

export const IsItem = IsObject({
    id: IsItemId,
    title: IsString,
    description: IsString.orUndefined,
    done: IsBoolean,
    createdAt: IsUint,
    updatedAt: IsUint
})
export type Item = typeof IsItem.infer

export const IsCreateItemRequest = IsObject({
    title: IsString.nonEmpty,
    description: IsString.orUndefined
})
export type CreateItemRequest = typeof IsCreateItemRequest.infer

export const IsUpdateItemRequest = IsObject({
    id: IsItemId,
    title: IsString.orUndefined,
    description: IsString.orUndefined
})
export type UpdateItemRequest = typeof IsUpdateItemRequest.infer

export const IsItemIdParam = IsObject({
    id: IsItemId
})

// ---------------------------------------------------------
// Contract & API
// ---------------------------------------------------------

export const MyApiContract = new GGContractClass("MyApi", {
    list: {
        success: IsArray(IsItem),
        errors: [SERVER_ERROR]
    },
    get: {
        input: IsItemIdParam,
        success: IsItem,
        errors: [NOT_FOUND, SERVER_ERROR]
    },
    create: {
        input: IsCreateItemRequest,
        success: IsItem,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    },
    update: {
        input: IsUpdateItemRequest,
        success: IsItem,
        errors: [NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    delete: {
        input: IsItemIdParam,
        errors: [NOT_FOUND, SERVER_ERROR]
    }
})

export const MyApi = httpSchema(MyApiContract)
    .pathPrefix("api/items")
    .routes({
        list: GGRpc.GET("list"),
        get: GGRpc.GET("get/:id"),
        create: GGRpc.POST("create"),
        update: GGRpc.PUT("update"),
        delete: GGRpc.DELETE("delete/:id")
    })
```

### HTTP Methods

```typescript
GGRpc.GET("path")      // GET request
GGRpc.POST("path")     // POST request
GGRpc.PUT("path")      // PUT request
GGRpc.DELETE("path")   // DELETE request
```

### Path Parameters

Use `:paramName` in paths - parameters are matched by position:

```typescript
export const MyApiContract = new GGContractClass("MyApi", {
    getUser: {
        input: IsObject({ userId: IsUserId }),
        success: IsUser,
        errors: [NOT_FOUND, SERVER_ERROR]
    },
    getUserPost: {
        input: IsObject({ userId: IsUserId, postId: IsPostId }),
        success: IsPost,
        errors: [NOT_FOUND, SERVER_ERROR]
    }
})

export const MyApi = httpSchema(MyApiContract)
    .pathPrefix("api")
    .routes({
        getUser: GGRpc.GET("users/:userId"),
        getUserPost: GGRpc.GET("users/:userId/posts/:postId")
    })
```

### Query Parameters

For GET/DELETE, object parameters become query strings:

```typescript
export const MyApiContract = new GGContractClass("MyApi", {
    search: {
        input: IsObject({
            term: IsString,
            page: IsUint.orUndefined,
            limit: IsUint.orUndefined
        }),
        success: IsSearchResults,
        errors: [SERVER_ERROR]
    }
})

// Client usage: client.search({ term: "foo", page: 1 })
// Results in: GET /api/search?term=foo&page=1
```

### Request Body

For POST/PUT, the input becomes the JSON body:

```typescript
export const MyApiContract = new GGContractClass("MyApi", {
    create: {
        input: IsCreateRequest,
        success: IsItem,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    },
    update: {
        input: IsUpdateRequest,
        success: IsItem,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    }
})
```

## Permissions

Contract methods may declare a `permission`. The framework gates every request against the declared permission **before the handler runs**, so missing or wrong scopes can never reach service code. Declarations are opt-in but *infectious*: once any route on the server declares one (or `.usePermissions(...)` is wired), every route on the server must declare — the runtime refuses to start otherwise (see "Hard guarantee" below).

The wiring chain is read top-to-bottom:

```typescript
new GGHttp(httpServer)
    .use(new JwtAuthMiddleware(secret))   // parses the token → context
    .usePermissions(getScopes)             // reads context → scope set
    .http(ItemApi, new ItemApiImpl())
```

Each step has one job: the auth middleware turns a token into identity in context; the scope resolver (a zero-arg `() => ReadonlySet<string> | null`, sync or async) extracts the caller's scopes from that context; the gate calls the resolver, checks `satisfies(method.permission, scopes)`, and throws `NOT_AUTHORIZED` (no identity) or `FORBIDDEN` (wrong scopes). Order matters — `.usePermissions(...)` must come before the `.http(...)` calls it should apply to.

**Hard guarantee.** At server start the framework walks every HTTP / WS route registered on the `GGHttpServer`. If any of them declared a permission, or any chain wired `.usePermissions(...)`, **strict mode** is on for the whole server. In strict mode:

- Every route must declare `permission` — use `GG_NO_PERMISSIONS` for intentionally public ones. Routes that omit it fail the start and are listed by name.
- A route declaring a non-public permission without a resolver on its registering chain also fails the start.

The check is per-server (HTTP routes + WS schemas on the same `GGHttpServer`), so a permission declared anywhere is infectious across sibling chains. The only way to opt out is to declare nothing — projects with no auth pay zero ceremony, but the moment one route opts in, the framework forces consistency.

**What this does not cover.** The permission gates *endpoint access* — "is this caller allowed to invoke this method at all?" It does not handle *resource access* — "can this caller edit *this specific* post?" That check still belongs in the handler. The same `GGPermissionChecker` the gate used is exposed via `GG_PERMISSIONS.get()`, so handler-side sub-decisions use identical logic with no drift between framework and app code.

## Authentication & Context

### Using Codec (Recommended for Header-Based Auth)

```typescript
// auth/UserAuth.ts
import { GGContextKey } from "@grest-ts/context"
import { IsObject, IsString } from "@grest-ts/schema"

export const IsUserAuthToken = IsString.brand("UserAuthToken")
export type tUserAuthToken = typeof IsUserAuthToken.infer

export const IsUserId = IsString.brand("UserId")
export type tUserId = typeof IsUserId.infer

export const IsUser = IsObject({
    id: IsUserId,
    username: IsString,
    email: IsString
})
export type User = typeof IsUser.infer

// Define the context value schema
const IsUserAuthContext = IsObject({
    token: IsUserAuthToken
})
export type UserAuthContext = typeof IsUserAuthContext.infer

// Define the header schema
const HEADER_AUTHORIZATION = "authorization"
const HeaderType = IsObject({
    [HEADER_AUTHORIZATION]: IsString.orUndefined
})

// Create context key with codec
export const GG_USER_AUTH = new GGContextKey<UserAuthContext>("user_auth", IsUserAuthContext)
GG_USER_AUTH.addCodec("http", HeaderType.codecTo(IsUserAuthContext, {
    encode: (headers) => {
        const authHeader = headers[HEADER_AUTHORIZATION]
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return { token: undefined as any }  // Will fail validation if required
        }
        return { token: authHeader.substring(7) as tUserAuthToken }
    },
    decode: (value) => {
        return { [HEADER_AUTHORIZATION]: value.token ? `Bearer ${value.token}` : undefined }
    }
}))
```

### Using Middleware (For Complex Logic)

```typescript
// middleware/ClientInfoMiddleware.ts
import { GGHttpRequest, GGHttpTransportMiddleware } from "@grest-ts/http"
import { GGContextKey } from "@grest-ts/context"
import { IsObject, IsString, IsLiteral } from "@grest-ts/schema"

export interface ClientInfo {
    version: string
    platform: 'web' | 'ios' | 'android'
}

export const GG_CLIENT_INFO = new GGContextKey<ClientInfo>('clientInfo', IsObject({
    version: IsString,
    platform: IsLiteral("web", "ios", "android")
}))

export const ClientInfoMiddleware: GGHttpTransportMiddleware = {
    headers: ['x-client-version', 'x-client-platform'],
    responseHeaders: [],
    updateRequest(req: GGHttpRequest): void {
        const info = GG_CLIENT_INFO.get()
        if (info) {
            req.headers['x-client-version'] = info.version
            req.headers['x-client-platform'] = info.platform
        }
    },
    parseRequest(req: GGHttpRequest): void {
        GG_CLIENT_INFO.set({
            version: req.headers['x-client-version'] ?? 'unknown',
            platform: (req.headers['x-client-platform'] ?? 'web') as ClientInfo['platform']
        })
    }
}
```

### Adding Auth/Context to API

```typescript
import { GG_USER_AUTH } from "./auth/UserAuth"
import { ClientInfoMiddleware } from "./middleware/ClientInfoMiddleware"
import { GG_INTL_LOCALE } from "@grest-ts/intl"

export const MyApiContract = new GGContractClass("MyApi", {
    list: {
        success: IsArray(IsItem),
        errors: [NOT_AUTHORIZED, SERVER_ERROR]
    },
    create: {
        input: IsCreateRequest,
        success: IsItem,
        errors: [NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR]
    }
})

// Chain multiple context providers
export const MyApi = httpSchema(MyApiContract)
    .pathPrefix("api/items")
    .useHeader(GG_INTL_LOCALE)        // Use codec from context key
    .useHeader(GG_USER_AUTH)          // Use codec from context key
    .use(ClientInfoMiddleware)        // Use middleware object
    .routes({
        list: GGRpc.GET("list"),
        create: GGRpc.POST("create")
    })
```

### Public API (No Auth)

```typescript
export const PublicApiContract = new GGContractClass("PublicApi", {
    status: {
        success: IsStatusResponse,
        errors: [SERVER_ERROR]
    },
    login: {
        input: IsLoginRequest,
        success: IsLoginResponse,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    }
})

export const PublicApi = httpSchema(PublicApiContract)
    .pathPrefix("pub")
    .routes({
        status: GGRpc.GET("status"),
        login: GGRpc.POST("login")
    })
```

## Error Types

### Declaring Errors in Contract

```typescript
import { GGContractClass, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR, BAD_REQUEST, ERROR } from "@grest-ts/schema"

// Custom error type
const INVALID_CREDENTIALS = ERROR.define("INVALID_CREDENTIALS", 400)

export const MyApiContract = new GGContractClass("MyApi", {
    get: {
        input: IsItemIdParam,
        success: IsItem,
        errors: [NOT_FOUND, SERVER_ERROR]
    },
    update: {
        input: IsUpdateRequest,
        success: IsItem,
        errors: [NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    login: {
        input: IsLoginRequest,
        success: IsLoginResponse,
        errors: [INVALID_CREDENTIALS, VALIDATION_ERROR, SERVER_ERROR]
    }
})
```

### Throwing Errors in Service

```typescript
import { NOT_FOUND, FORBIDDEN } from "@grest-ts/schema"

export class MyService {
    async get({ id }: { id: tItemId }): Promise<Item> {
        const item = await this.findItem(id)
        if (!item) throw new NOT_FOUND()
        return item
    }

    async update(request: UpdateRequest): Promise<Item> {
        const item = await this.findItem(request.id)
        if (!item) throw new NOT_FOUND()

        const user = GG_USER_AUTH.get()
        if (item.ownerId !== user.id) throw new FORBIDDEN()

        return this.updateItem(item, request)
    }
}
```

## HTTP Server Setup

### Using GGHttp (Fluent API)

```typescript
import { GGHttp, GGHttpServer } from "@grest-ts/http"

protected compose(): void {
    const httpServer = new GGHttpServer()

    new GGHttp(httpServer)
        .http(PublicApi, publicService)
        .http(StatusApi, {
            status: async () => ({ status: true })
        })

    new GGHttp(httpServer)
        .use(new UserContextMiddleware(userService))
        .http(MyApi, myService)
        .http(UserAuthApi, userService)
}
```

### Using GGHttpSchema.register (Direct)

```typescript
import { GGHttpServer } from "@grest-ts/http"

protected compose(): void {
    const httpServer = new GGHttpServer()
    MyApi.register(myService, { http: httpServer })
    OtherApi.register(otherService, { http: httpServer })
}
```

### Multiple HTTP Servers

```typescript
protected compose(): void {
    // Main public server
    const publicServer = new GGHttpServer()
    new GGHttp(publicServer)
        .http(PublicApi, publicService)

    // Internal server on different port
    const internalServer = new GGHttpServer({ port: 9090 })
    new GGHttp(internalServer)
        .http(InternalApi, internalService)
}
```

### CORS Headers

CORS `Access-Control-Allow-Headers` are auto-discovered from middleware and codecs.
Only `Content-Type` is included by default (it's set by the framework's RPC layer).
All other headers — including `Authorization` — are registered automatically when
middleware declares them via `headers` or when `useHeader()` extracts them from codecs.

When using `useHeader()`, header names are extracted from the codec's input schema automatically:

```typescript
const HeaderType = IsObject({
    "x-org-token": IsString.orUndefined  // Auto-discovered as CORS header
})
GG_ORG_TOKEN.addCodec("http", HeaderType.codecTo(...))

httpSchema(Contract)
    .useHeader(GG_ORG_TOKEN)  // "x-org-token" added to CORS Allow-Headers
    .routes({ ... })
```

Both `headers` (request) and `responseHeaders` (response) are required on middleware and codecs —
TypeScript enforces this at compile time. Use `[]` when not applicable:

```typescript
export const MyMiddleware: GGHttpTransportMiddleware = {
    headers: ['x-custom-header'],
    responseHeaders: [],
    updateRequest(req) { ... },
    parseRequest(req) { ... }
}
```

Codecs also declare `responseHeaders`. For example, `GGFileDownload` declares
`['Content-Disposition']` which is automatically added to `Access-Control-Expose-Headers`.

You can also register headers manually on the server:

```typescript
const httpServer = new GGHttpServer()
httpServer.registerCorsHeaders(['x-custom-header'])
httpServer.registerCorsExposeHeaders(['x-custom-response-header'])
```

## HTTP Client

### Creating Clients

```typescript
import { GGHttpClientConfig } from "@grest-ts/http"

// With explicit URL
const client = MyApi.createClient({ url: "http://localhost:3000" })

// Browser same-origin (use empty string)
const client = MyApi.createClient({ url: "" })

// With options
const client = MyApi.createClient({ url: "http://localhost:3000", timeout: 30000 })

// Without URL (uses service discovery)
const client = MyApi.createClient()
```

### Making Requests

```typescript
// Simple request (no input)
const items = await client.list()

// With path parameter
const item = await client.get({ id: "item-123" })

// With query parameters (GET request)
const results = await client.search({ term: "foo", page: 1 })

// With body (POST request)
const newItem = await client.create({ title: "New Item" })
```

### Handling Results

```typescript
// Direct (throws on error)
const item = await client.get({ id: "item-123" })

// Using .asResult() for safe error handling
const result = await client.get({ id: "item-123" }).asResult()
if (result.success) {
    console.log("Item:", result.data)
} else {
    console.log("Error:", result.type)  // "NOT_FOUND", etc.
}

// Using .orDefault() for fallback values
const item = await client.get({ id: "item-123" }).orDefault(() => defaultItem)

// Using .or() for error recovery
const item = await client.get({ id: "item-123" }).or((error) => {
    if (error.type === "NOT_FOUND") return defaultItem
    throw error
})

// Using .map() to transform the result
const title = await client.get({ id: "item-123" }).map(item => item.title)
```

## WebSocket APIs

### Defining WebSocket API

```typescript
import { defineSocketContract, webSocketSchema } from "@grest-ts/websocket"
import { IsObject, IsString, IsBoolean, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema"

// Message schemas
export const IsItemMarkedEvent = IsObject({
    item: IsItem,
    markedBy: IsString
})
export type ItemMarkedEvent = typeof IsItemMarkedEvent.infer

export const IsUpdateItemRequest = IsObject({
    item: IsItem,
    reason: IsString.orUndefined
})

export const IsUpdateItemResponse = IsObject({
    success: IsBoolean,
    message: IsString
})

// Contract definition
export const NotificationApiContract = defineSocketContract("NotificationApi", {
    clientToServer: {
        updateItem: {
            input: IsUpdateItemRequest,
            success: IsUpdateItemResponse,
            errors: [VALIDATION_ERROR, SERVER_ERROR]
        },
        ping: {}
    },
    serverToClient: {
        itemMarked: {
            input: IsItemMarkedEvent
        },
        areYouThere: {
            success: IsBoolean,
            errors: [SERVER_ERROR]
        }
    }
})

export const NotificationApi = webSocketSchema(NotificationApiContract)
    .path("ws/notifications")
    .use(AuthMiddleware)
    .done()
```

### WebSocket Server Handler

```typescript
import { WebSocketIncoming, WebSocketOutgoing } from "@grest-ts/websocket"

export class NotificationService {
    private connections = new Map<string, Set<WebSocketOutgoing<any>>>()

    handleConnection = (incoming: WebSocketIncoming<any>, outgoing: WebSocketOutgoing<any>): void => {
        const user = GG_USER_AUTH.get()

        // Track connection
        if (!this.connections.has(user.id)) {
            this.connections.set(user.id, new Set())
        }
        this.connections.get(user.id)!.add(outgoing)

        // Handle incoming messages
        incoming.on({
            updateItem: async (request) => {
                // Process update
                return { success: true, message: "Updated" }
            },
            ping: async () => {
                // Handle ping
            }
        })

        // Handle disconnect
        outgoing.onClose(() => {
            this.connections.get(user.id)?.delete(outgoing)
        })
    }

    // Broadcast to user
    notifyUser(userId: string, event: ItemMarkedEvent): void {
        const userConnections = this.connections.get(userId)
        userConnections?.forEach(conn => conn.itemMarked(event))
    }
}
```

### WebSocket in Runtime

```typescript
import { GGHttpServer } from "@grest-ts/http"

protected compose(): void {
    const httpServer = new GGHttpServer()

    new GGHttp(httpServer)
        .use(new UserContextMiddleware(userService))
        .http(MyApi, myService)

    // Register WebSocket on the same HTTP server
    NotificationApi.register(notificationService.handleConnection, { http: httpServer })
}
```

### WebSocket Client

```typescript
import { GGSocketPool } from "@grest-ts/websocket"

// Connect via socket pool (reuses connections for same URL + headers)
const socket = await GGSocketPool.getOrConnect({
    domain: "ws://localhost:3000",
    path: "/ws/notifications",
    middlewares: NotificationApi.middlewares
})

// Send messages via the socket
const response = await socket.send("NotificationApi.updateItem", { item, reason: "Updated via UI" }, true)

// Handle disconnect
socket.onClose(() => {
    console.log("Disconnected")
})

// Close connection
socket.close()

// Close all pooled connections
await GGSocketPool.closeAll()
```

