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
import { GGRpc, httpApi } from "@grest-ts/http"
import { IsArray, IsObject, IsString, IsBoolean, IsUint } from "@grest-ts/schema"
import { defineApi, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR } from "@grest-ts/contract"

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

export const MyApiContract = defineApi("MyApi", () => ({
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
        success: undefined as undefined,
        errors: [NOT_FOUND, SERVER_ERROR]
    }
}))

export const MyApi = httpApi(MyApiContract)
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
GGRpc.PATCH("path")    // PATCH request
GGRpc.DELETE("path")   // DELETE request
```

### Path Parameters

Use `:paramName` in paths - parameters are matched by position:

```typescript
export const MyApiContract = defineApi("MyApi", () => ({
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
}))

export const MyApi = httpApi(MyApiContract)
    .pathPrefix("api")
    .routes({
        getUser: GGRpc.GET("users/:userId"),
        getUserPost: GGRpc.GET("users/:userId/posts/:postId")
    })
```

### Query Parameters

For GET/DELETE, object parameters become query strings:

```typescript
export const MyApiContract = defineApi("MyApi", () => ({
    search: {
        input: IsObject({
            term: IsString,
            page: IsUint.orUndefined,
            limit: IsUint.orUndefined
        }),
        success: IsSearchResults,
        errors: [SERVER_ERROR]
    }
}))

// Client usage: client.search({ term: "foo", page: 1 })
// Results in: GET /api/search?term=foo&page=1
```

### Request Body

For POST/PUT/PATCH, the input becomes the JSON body:

```typescript
export const MyApiContract = defineApi("MyApi", () => ({
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
}))
```

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

export const MyApiContract = defineApi("MyApi", () => ({
    list: {
        success: IsArray(IsItem),
        errors: [NOT_AUTHORIZED, SERVER_ERROR]
    },
    create: {
        input: IsCreateRequest,
        success: IsItem,
        errors: [NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR]
    }
}))

// Chain multiple context providers
export const MyApi = httpApi(MyApiContract)
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
export const PublicApiContract = defineApi("PublicApi", () => ({
    status: {
        success: IsStatusResponse,
        errors: [SERVER_ERROR]
    },
    login: {
        input: IsLoginRequest,
        success: IsLoginResponse,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    }
}))

export const PublicApi = httpApi(PublicApiContract)
    .pathPrefix("pub")
    .routes({
        status: GGRpc.GET("status"),
        login: GGRpc.POST("login")
    })
```

## Error Types

### Declaring Errors in Contract

```typescript
import { defineApi, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR, BAD_REQUEST } from "@grest-ts/contract"

// Custom error type
export class InvalidCredentialsError extends BAD_REQUEST<"INVALID_CREDENTIALS", undefined> {
    public static TYPE = "INVALID_CREDENTIALS"

    constructor() {
        super("INVALID_CREDENTIALS", undefined)
    }
}

export const MyApiContract = defineApi("MyApi", () => ({
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
        errors: [InvalidCredentialsError, VALIDATION_ERROR, SERVER_ERROR]
    }
}))
```

### Throwing Errors in Service

```typescript
import { GGServerApi, NOT_FOUND, FORBIDDEN } from "@grest-ts/node"

export class MyService implements GGServerApi<typeof MyApiContract["methods"]> {
    async get({ id }: { id: tItemId }): Promise<Item> {
        const item = await this.findItem(id)
        if (!item) throw new NOT_FOUND()
        return item
    }

    async update(request: UpdateRequest): Promise<Item> {
        const item = await this.findItem(request.id)
        if (!item) throw new NOT_FOUND()

        const user = UserContext.get()
        if (item.ownerId !== user.id) throw new FORBIDDEN()

        return this.updateItem(item, request)
    }
}
```

## HTTP Server Setup

### Using GGHttp (Fluent API)

```typescript
import { GGHttp } from "@grest-ts/http"

protected compose(): void {
    new GGHttp()
        .http(PublicApi, publicService)
        .http(StatusApi, {
            status: async () => ({ status: true })
        })

    new GGHttp("authenticated")
        .use(new UserContextMiddleware(userService))
        .http(MyApi, myService)
        .http(UserAuthApi, userService)
        .websocket(NotificationApi, notificationService.handleConnection)
}
```

### Using GGHttpServer (Direct)

```typescript
import { GGHttpServer } from "@grest-ts/http"

protected compose(): void {
    const httpServer = new GGHttpServer()
    MyApi.startServer(httpServer, myService)
    OtherApi.startServer(httpServer, otherService)
}
```

### Multiple HTTP Servers

```typescript
protected compose(): void {
    // Main public server
    new GGHttp()
        .http(PublicApi, publicService)

    // Internal server on different port
    new GGHttp("internal")
        .http(InternalApi, internalService)
}
```

## HTTP Client

### Creating Clients

```typescript
// Unauthenticated client
const client = MyApi.createClient({ url: "http://localhost:3000" })

// Authenticated client
const authClient = MyApi.createClient(authState, { url: "http://localhost:3000" })

// Test client
const testClient = MyApi.createTestClient()
```

### Making Requests

```typescript
// Simple request
const items = await client.list()

// With path parameter
const item = await client.get({ id: "item-123" })

// With query parameters
const results = await client.search({ term: "foo", page: 1 })

// With body
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
```

## WebSocket APIs

### Defining WebSocket API

```typescript
import { webSocketApi } from "@grest-ts/http"
import { defineTwoWayApi, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/contract"
import { IsObject, IsString, IsBoolean } from "@grest-ts/schema"
import { GG_USER_AUTH_TOKEN } from "./auth/UserAuth"

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
export const NotificationApiContract = defineTwoWayApi("NotificationApi", () => ({
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
}))

export const NotificationApi = webSocketApi(NotificationApiContract)
    .path("ws/notifications")
    .use(GG_USER_AUTH_TOKEN)
    .done()
```

### WebSocket Server Handler

```typescript
import { GGSocketApi, WebSocketIncoming, WebSocketOutgoing } from "@grest-ts/http"

type IncomingHandler = WebSocketIncoming<GGSocketApi<typeof NotificationApiContract.methods["clientToServer"]>>
type OutgoingConnection = WebSocketOutgoing<GGSocketApi<typeof NotificationApiContract.methods["serverToClient"]>>

export class NotificationService {
    private connections = new Map<string, Set<OutgoingConnection>>()

    handleConnection = (incoming: IncomingHandler, outgoing: OutgoingConnection): void => {
        const user = UserContext.get()

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
protected compose(): void {
    new GGHttp()
        .use(new UserContextMiddleware(userService))
        .websocket(NotificationApi, notificationService.handleConnection)
}
```

### WebSocket Client (Browser)

```typescript
// Connect with message handlers
const socket = await authenticatedSDK.connectNotification({
    itemMarked: (event) => {
        console.log("Item marked:", event.item.title)
    },
    areYouThere: async () => {
        return true
    }
})

// Send messages
const response = await socket.updateItem({ item, reason: "Updated via UI" })

// Close connection
socket.close()
```

## SDK (Auto-Generated)

The SDK is auto-generated from your API definitions. The generated SDK provides:

- Type-safe client methods for all endpoints
- Automatic auth token handling
- WebSocket connection management
- Error type inference

### Using Generated SDK

```typescript
import { UserAppSDK } from "./UserAppSDK.gen"

const sdk = new UserAppSDK({ url: "http://localhost:3000" })

// Public endpoints
const loginResult = await sdk.login({ username, password })

// Authenticated endpoints (returned from login)
const authSDK = loginResult.data.sdk
const items = await authSDK.checklist.list()
const socket = await authSDK.connectNotification({
    itemMarked: (event) => console.log(event)
})
```
