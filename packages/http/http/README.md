<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# HTTP Package Usage (@grest-ts/http)

How to use the HTTP package for building type-safe HTTP and WebSocket APIs.

## HTTP API Definition

### Basic API Structure

A schema is a plain object passed to `new GGHttpSchema({...})`: a `contract`, a
`pathPrefix`, a `routes` map (one verb helper per contract method), and an optional
`use` array of wires (omit it for a public API).

```typescript
// MyApi.ts
import { GGRpc, GGHttpSchema } from "@grest-ts/http"
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

export const MyApi = new GGHttpSchema({
    contract: MyApiContract,
    pathPrefix: "api/items",
    routes: {
        list: GGRpc.GET("list"),
        get: GGRpc.GET("get/:id"),
        create: GGRpc.POST("create"),
        update: GGRpc.PUT("update"),
        delete: GGRpc.DELETE("delete/:id")
    }
})
```

Every key in `routes` must match a method key on the contract. The verb helpers
(`GGRpc.GET/POST/PUT/DELETE`) are unchanged.

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

export const MyApi = new GGHttpSchema({
    contract: MyApiContract,
    pathPrefix: "api",
    routes: {
        getUser: GGRpc.GET("users/:userId"),
        getUserPost: GGRpc.GET("users/:userId/posts/:postId")
    }
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

Contract methods may declare a `permission`. The framework gates every request against the declared permission **before the handler runs**, so missing or wrong scopes can never reach service code. The caller's scopes come from the **wires** the schema lists in `use: [...]` (see "Authentication & Context" below) — a smart wire verifies the credential and exposes the caller's grants via its `permissions()` resolver. There is no separate `.usePermissions(...)` step and no auth-middleware chain; the schema's wires ARE the source of scopes.

Declarations are opt-in but *infectious*: once any route on the server declares a `permission`, every route on the server must declare one — the runtime refuses to start otherwise (see "Hard guarantee" below).

```typescript
// contract: declare the permission a route requires
export const ItemApiContract = new GGContractClass("ItemApi", {
    list:   { success: IsArray(IsItem), errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS },
    delete: { input: IsItemIdParam, errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR], permission: ItemPermission.DELETE },
})

// schema: list the wire that authenticates + resolves scopes for these routes
export const ItemApi = new GGHttpSchema({
    contract: ItemApiContract,
    pathPrefix: "api/items",
    use: [USER_TOKEN_WIRE],
    routes: { list: GGRpc.GET("list"), delete: GGRpc.DELETE("delete/:id") },
})
```

The gate reads the method's `permission`, collects the caller's grants from every wire on the schema (each wire's `permissions()`), pools them into one set, checks `satisfies(method.permission, pooledGrants)`, and throws `NOT_AUTHORIZED` (a wire couldn't authenticate) or `FORBIDDEN` (authenticated, wrong scopes).

**Multi-wire composition (AND across sources).** A schema may list more than one auth wire in `use: [...]` (e.g. a user wire AND an org wire). Each wire's server handler runs at the request boundary, so **every** wire must authenticate — any one throwing rejects the request. That is the AND across sources. For scope checks the grants from all wires are **pooled** into one set, and the method's `permission` must be satisfied by that union; grants are matched by string against the pool, with no per-wire ownership of permission strings. A route that declares a non-public `permission` on a schema with **no** permission-resolving wire can never be satisfied (its pooled grants are always empty), so it fails at startup — see the hard guarantee below.

**Hard guarantee.** At server start the framework walks every HTTP / WS route registered on the `GGHttpServer`, before it accepts traffic. Two guarantees hold:

- **Wires are implemented (always).** A `use`d wire that was never implemented (no `.define(...).create(deps)` in `compose()`) fails the start — a listed wire must work or the request fails loud. This runs regardless of whether any permission is declared.
- **Permission coverage (strict mode).** If any route declared a permission, **strict mode** is on for the whole server: every route must declare `permission` — use `GG_NO_PERMISSIONS` for intentionally public ones. Routes that omit it fail the start and are listed by name.

The coverage check is per-server (HTTP routes + WS schemas on the same `GGHttpServer`), so a permission declared anywhere is infectious across sibling chains. The only way to opt out is to declare nothing — projects with no auth pay zero ceremony, but the moment one route opts in, the framework forces consistency.

**What this does not cover.** The permission gates *endpoint access* — "is this caller allowed to invoke this method at all?" It does not handle *resource access* — "can this caller edit *this specific* post?" That check still belongs in the handler, which reads the app's own durable principal (minted by the wire's `process()`) — not a framework scope bag.

## Authentication & Context

Authentication and per-request context ride on **wires**. A wire (`GGHeader` / `GGCookie`)
*is* a context key and a transport middleware at once: it reads a value off the inbound
request and attaches to a schema by listing it in the schema's `use: [WIRE]` array. The
schema declares the wire once and every method on it parses (and, for credentials, verifies)
that wire — you can't forget it on a method, and "is this endpoint protected?" is readable
off the schema.

There are two tiers, decided by whether the wire is `.define()`d server-side:

- **Smart (credential) wire** — verified. Holds the raw inbound credential, which is
  **ephemeral**: verified inside the server handler's `process()`, then cleared *before*
  the route handler runs. Handlers read a durable principal the handler minted, never the
  token. Requires `.define()` (server) and `.create(deps)` (per runtime).
- **Ambient wire** — never `.define()`d. The parsed value lands in the wire and persists
  through the handler (read via `WIRE.get()`). For non-credential headers where absent →
  `undefined` is fine.

### Smart wire — token auth (the common case)

The wire and its identity types live in the shared `api/`; the verification handler and the
durable principal live **server-side only** (handlers/services read it; the client never sees it).

```typescript
// api/auth/UserAuth.ts  (shared)
import { GGHeader } from "@grest-ts/http"
import { IsArray, IsEnum, IsObject, IsString } from "@grest-ts/schema"

export enum UserPermission { CAN_EDIT = "CAN_EDIT" }
export const IsUserPermission = IsEnum(UserPermission)

export const IsUserId = IsString.brand("UserId")
export const IsUser = IsObject({
    id: IsUserId,
    username: IsString,
    email: IsString,
    permissions: IsArray(IsUserPermission),
})
export type User = typeof IsUser.infer

// SMART wire: parses `Authorization: Bearer <jwt>`. The raw token is ephemeral — readable
// only inside the server handler's process(), then cleared before the route handler runs.
export const USER_TOKEN_WIRE = new GGHeader("authorization", { scheme: "bearer" })
```

```typescript
// server/auth/UserAuthHandler.ts  (server-only)
import { GGContextKey } from "@grest-ts/context"
import { NOT_AUTHORIZED } from "@grest-ts/schema"
import { deepFreeze } from "@grest-ts/common"
import { IsUser, USER_TOKEN_WIRE } from "../../api/auth/UserAuth"
import type { UserService } from "../services/UserService"

// The durable principal — server-only. USER_DATA IS the User (it owns its permissions).
// Deep-frozen on set() so a handler can't mutate it to escalate.
export const USER_DATA = new GGContextKey("userData", IsUser)

// .define() attaches the verification handler. Process-global, frozen once (a second
// .define() throws). The returned registration is .create()d once per runtime in compose().
export const USER_TOKEN_WIRE_HANDLER = USER_TOKEN_WIRE.define((users: UserService) => ({
    process: async () => {
        // USER_TOKEN_WIRE.get() returns the raw bearer token — readable ONLY here.
        const user = await users.verifyAccessToken(USER_TOKEN_WIRE.get())
        if (!user) throw new NOT_AUTHORIZED({ debugMessage: "invalid token" })
        USER_DATA.set(deepFreeze(user))
    },
    // The caller's grants, read off the durable principal — feeds the per-method gate.
    permissions: async () => USER_DATA.get()!.permissions,
}))
```

List the wire in `use: [...]` on every schema whose routes need it, and `.create()` its
handler once in the runtime's `compose()`:

```typescript
// api/UserApi.ts
export const UserApi = new GGHttpSchema({
    contract: UserApiContract,
    pathPrefix: "api/users",
    use: [USER_TOKEN_WIRE],            // every route here verifies the token
    routes: { me: GGRpc.GET("me"), updateProfile: GGRpc.PUT("profile") },
})
```

```typescript
// server/AppRuntime.ts
protected compose(): void {
    const userService = new UserService(tokenEngine)

    // Bind the wire's deps into THIS runtime's scope — once per runtime (a fresh test
    // worker / restart gets its own scope). Deps must be async-context-bound + stateless.
    USER_TOKEN_WIRE_HANDLER.create(userService)

    new GGHttp(new GGHttpServer())
        .http(UserApi, userService)
}
```

In a handler or service, read the durable principal — never the token:

```typescript
export class UserService {
    me = async (): Promise<User> => USER_DATA.get()   // identity for this request
}
```

### Ambient wire — non-credential headers

For a header where absent → `undefined` is acceptable and there's nothing to verify, use a
bare wire (no `.define()`). The value lands in the wire and persists through the handler:

```typescript
// shared api/
export const CLIENT_VERSION_WIRE = new GGHeader("x-client-version")   // ambient

new GGHttpSchema({
    contract: MyContract,
    pathPrefix: "api",
    use: [CLIENT_VERSION_WIRE],
    routes: { ... },
})

// in a handler — read it directly:
const version = CLIENT_VERSION_WIRE.get()   // string | undefined
```

When you need several headers folded into one structured context value, write a custom
`GGTransportMiddleware` (one shape for HTTP and WebSocket). The runtime calls only the
hooks each side needs: a client runs `update(outbound)` to write outbound headers; a server
runs `parse(inbound)` to read inbound headers. Declare the headers it touches via `headers`
so CORS + doc-gen pick them up. Use this for ambient context — **not** for credentials,
which belong on a smart wire so the token can't leak into handler code.

```typescript
// middleware/ClientInfoMiddleware.ts
import { GGTransportMiddleware, GGInbound, GGOutbound, GGContextKey } from "@grest-ts/context"
import { IsObject, IsString, IsLiteral } from "@grest-ts/schema"

export interface ClientInfo { version: string; platform: 'web' | 'ios' | 'android' }

export const GG_CLIENT_INFO = new GGContextKey<ClientInfo>('clientInfo', IsObject({
    version: IsString,
    platform: IsLiteral("web", "ios", "android"),
}))

export const ClientInfoMiddleware: GGTransportMiddleware = {
    headers: { 'x-client-version': IsString.orUndefined, 'x-client-platform': IsString.orUndefined },
    update(outbound: GGOutbound): void {
        const info = GG_CLIENT_INFO.get()
        if (info) {
            outbound.headers['x-client-version'] = info.version
            outbound.headers['x-client-platform'] = info.platform
        }
    },
    parse(inbound: GGInbound): void {
        GG_CLIENT_INFO.set({
            version: inbound.headers['x-client-version'] ?? 'unknown',
            platform: (inbound.headers['x-client-platform'] ?? 'web') as ClientInfo['platform'],
        })
    },
}

new GGHttpSchema({ contract: MyContract, pathPrefix: "api", use: [ClientInfoMiddleware], routes: { ... } })
```

### Client — sending the credential

The browser app does **not** hand-write the outbound side. `GGAuthSession` (from
`@grest-ts/auth`) owns the token lifecycle (localStorage persistence, cross-tab refresh
dedup, proactive refresh) and configures the wires it holds itself:

```typescript
import { GGAuthSession } from "@grest-ts/auth"
import { USER_TOKEN_WIRE } from "../../api/auth/UserAuth"

export const session = GGAuthSession
    .withToken(USER_TOKEN_WIRE, { refresh: api.authApi.refresh, localStorageKey: "auth" })
```

For the no-session case (a static service-to-service API key), the underlying primitive is
`WIRE.defineClient({ value: () => API_KEY })`.

### Public API (No Auth)

A public route simply lives on a schema that lists **no** auth wire in `use` (omit the field
entirely) — "what's public?" is answered by looking at the schema, not by reading handler
code. (There is no "optional auth": anonymous and authenticated variants live on separate
schemas.)

```typescript
export const PublicApiContract = new GGContractClass("PublicApi", {
    status: { success: IsStatusResponse, errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS },
    login:  { input: IsLoginRequest, success: IsLoginResponse, errors: [VALIDATION_ERROR, SERVER_ERROR], permission: GG_NO_PERMISSIONS },
})

export const PublicApi = new GGHttpSchema({
    contract: PublicApiContract,
    pathPrefix: "pub",                 // no `use` → public
    routes: {
        status: GGRpc.GET("status"),
        login: GGRpc.POST("login"),
    },
})
```

(`permission: GG_NO_PERMISSIONS` is only needed once any route on the server declares a
permission — see "Permissions" → strict mode.)

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

        const user = USER_DATA.get()
        if (item.ownerId !== user.id) throw new FORBIDDEN()

        return this.updateItem(item, request)
    }
}
```

## Server Implementation

The implementation is a plain class. `typeof Contract.infer` gives its method shape — keep
the alias next to the class:

```typescript
import type { BenchmarkRequest, BenchmarkResponse } from "../api/BenchmarkApi"
import { BenchmarkApiContract } from "../api/BenchmarkApi"

type IBenchmarkApi = typeof BenchmarkApiContract.infer

export class BenchmarkService implements IBenchmarkApi {
    public async hello(request: BenchmarkRequest): Promise<BenchmarkResponse> {
        return { res: "Hello " + request.name }
    }
}
```

## HTTP Server Setup

### Registering with GGHttp

`GGHttp` is the single entry point: `new GGHttp(httpServer).http(Schema, impl)`, chained per
API. Auth wiring is **not** a chain on `GGHttp` — the schema carries the wire (`use: [WIRE]`)
and the runtime binds the wire's deps once via `WIRE_HANDLER.create(deps)`. `GGHttp.use(...)`
is reserved for *ambient* middleware (e.g. client-info, trace) that applies to every API
registered **after** it on that builder.

```typescript
import { GGHttp, GGHttpServer } from "@grest-ts/http"

protected compose(): void {
    const httpServer = new GGHttpServer()

    // Bind each used wire's handler into this runtime's scope (once per runtime).
    USER_TOKEN_WIRE_HANDLER.create(userService)

    new GGHttp(httpServer)
        .use(ClientInfoMiddleware)            // ambient middleware for every API below (optional)
        .http(PublicApi, publicService)       // no wire on its schema → public
        .http(MyApi, myService)               // MyApi schema uses USER_TOKEN_WIRE
        .http(UserAuthApi, userService)
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

CORS `Access-Control-Allow-Headers` are auto-discovered from the wires and middleware a
schema lists in `use`. Only `Content-Type` is included by default (it's set by the
framework's RPC layer). All other headers — including `Authorization` — are registered
automatically from each wire/middleware's declared header names.

A `GGHeader` wire carries its own header name, so listing it in `use` is enough — no extra
CORS wiring:

```typescript
export const ORG_TOKEN_WIRE = new GGHeader("x-org-token", {})   // smart wire, custom header

new GGHttpSchema({
    contract: Contract,
    pathPrefix: "api",
    use: [ORG_TOKEN_WIRE],    // "x-org-token" added to CORS Allow-Headers automatically
    routes: { ... },
})
```

A custom middleware declares the headers it reads via `headers` and the response headers it
sets via `responseHeaders` — both are `Record<string, GGSchema<string | undefined>>`,
keyed by header name. The names feed CORS auto-discovery; omit a field when not applicable:

```typescript
export const MyMiddleware: GGTransportMiddleware = {
    headers: { 'x-custom-header': IsString.orUndefined },
    update(outbound) { ... },
    parse(inbound) { ... }
}
```

Codecs also declare `responseHeaders`. For example, `GGFileDownload` declares
`Content-Disposition` which is automatically added to `Access-Control-Expose-Headers`.

You can also register headers manually on the server:

```typescript
const httpServer = new GGHttpServer()
httpServer.registerCorsHeaders(['x-custom-header'])
httpServer.registerCorsExposeHeaders(['x-custom-response-header'])
```

## Cookies (httpOnly sessions)

An httpOnly session cookie is a value the browser stores and re-sends automatically
that JavaScript cannot read (so XSS can't steal it). It is **server-minted**: the
server emits `Set-Cookie`, the browser stores and resends it, and JS never touches it.

A cookie is a **`GGCookie` wire** — it IS its own context key. Its name is the cookie
name. Attach it by listing `SESSION` in the schema's `use`; read it with `SESSION.get()` in
any handler; write it with the static `GGCookie.setCookie(SESSION, …)` / `clearCookie(SESSION)`
from a route that declared `.updatesCookie(SESSION)`:

```typescript
// shared api/
import {GGRpc, GGHttpSchema, GGCookie} from "@grest-ts/http"

// The wire's name IS the cookie name. No cookie policy in the shared API.
export const SESSION = new GGCookie("session")

export const AuthApi = new GGHttpSchema({
    contract: AuthContract,
    pathPrefix: "api/auth",
    use: [SESSION],
    routes: {
        login:  GGRpc.POST("login").updatesCookie(SESSION),   // may write the cookie
        logout: GGRpc.POST("logout").updatesCookie(SESSION),  // may write (clear)
        me:     GGRpc.GET("me"),                              // read-only -> no declaration
    },
})
```

```typescript
import {GGCookie} from "@grest-ts/http"
import {SESSION} from "../../api/AuthApi"

export class AuthService {
    login  = async (input: LoginRequest): Promise<User> => {
        const {user, token} = await this.verify(input)
        // Write rules live HERE, at the set site. Safe defaults (HttpOnly, Secure,
        // SameSite=Lax, Path=/) are applied; pass only what differs:
        GGCookie.setCookie(SESSION, token, {maxAgeSec: input.remember ? 60*60*24*30 : 60*60})
        return user
    }
    logout = async (): Promise<void> => { GGCookie.clearCookie(SESSION) }   // -> Max-Age=0 clear
    me     = async (): Promise<User>  => this.fromSession(SESSION.get())    // read the cookie
}
```

**Read vs write.** Reading is implicit — `SESSION.get()` works on any route whose schema
lists the cookie in `use`. **Writing is explicit**: only a route that declared
`.updatesCookie(SESSION)` may write it. A `GGCookie.setCookie(SESSION, …)` call from a route
that *didn't* declare it throws `SERVER_ERROR`, so a deep service function can't silently
mint or change someone's session — the capability is visible at the API boundary. The
inbound value stays set-once: the written value never touches `SESSION.get()`.

**Emit-on-write.** `setCookie`/`clearCookie` schedule a pending Set-Cookie that the wire
flushes onto the response: `setCookie(SESSION, token)` → `Set-Cookie`;
`clearCookie(SESSION)` (or `setCookie(SESSION, undefined)`) → `Max-Age=0` clear; a route
that writes nothing emits nothing.

**Write rules live at the `setCookie(value, options)` call site**, never in the shared API —
only the cookie name (needed to *read* it on every route) is on the schema. Options:
`httpOnly`, `secure`, `sameSite`, `path`, `domain`, `maxAgeSec`. Safe defaults (`HttpOnly`,
`Secure`, `SameSite=Lax`, `Path=/`) are applied by the serializer, so `setCookie(SESSION,
token)` is safe; pass only deviations. `SameSite=None` forces `Secure`; name/path/domain are
validated (no CR/LF/`;`). A scoped cookie repeats `path`/`domain` on clear so deletion matches:

```typescript
GGCookie.setCookie(SESSION, token, {path: "/api", domain: ".example.com", sameSite: "none", maxAgeSec: WEEK})
GGCookie.clearCookie(SESSION, {path: "/api", domain: ".example.com"})   // clear must match scope
```

**Domain scope is a security boundary.** The default is **host-only** (no `Domain`):
the cookie is sent only to the exact host that set it. `domain: ".example.com"` sends
it to **every** subdomain, so *any* subdomain — including user-controlled or untrusted
content — can read it. Never share a parent domain with untrusted subdomains; host
untrusted/user content on a **separate registrable domain** instead.

**Cross-site cookies.** A `SameSite=Lax` cookie is not sent on cross-site requests.
For a cross-site setup (browser and API on different sites) use `sameSite: "none"` +
`secure: true` **and** credentialed CORS on the server (below) with an exact-origin
allowlist — never a wildcard.

### Credentialed CORS (cross-origin cookies)

Cross-origin cookie requests require the response to echo the **specific** request
Origin plus `Access-Control-Allow-Credentials: true` — browsers reject the wildcard
`*` when credentials are involved. Opt in per server (default off keeps the
permissive `*`):

```typescript
new GGHttpServer({
    cors: {
        origins: ["https://app.example.com"],   // exact list, or (origin) => boolean
        credentials: true,
    },
})
```

Only an allowlisted Origin is echoed (never `*`), with `Vary: Origin`. Never reflect
an arbitrary origin with credentials — the allowlist is the gate.

### Client: send cookies

The browser attaches cross-origin cookies only when the caller opts in:

```typescript
const client = AuthApi.createClient({url: "https://api.example.com", credentials: "include"})
```

Same-origin calls and the default need nothing.

### WebSocket cookies

The same `GGCookie` wire works on a WebSocket schema, read-only: a browser auto-attaches
the httpOnly cookie to the WS **upgrade** request, and the runtime fills `inbound.cookie`
from that real upgrade header (never from the spoofable in-band handshake message). List the
same `SESSION` wire in the WS schema's `use` and read it at handshake with `SESSION.get()` — no
client code, no ticket dance. There is no `Set-Cookie` over a socket, so the wire only reads
there (`.updatesCookie` is an HTTP route concept). See `@grest-ts/websocket` → "Cookies".

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

### Connection settings — pinned-TLS dialing (node only)

A node client can dial a server over HTTPS and **pin its certificate by SHA-256 fingerprint** —
useful for self-signed, service-to-service targets (e.g. a fingerprint that rotates per server
start). No custom `transport` needed: create the client URL-less (`url: ""`) so the host comes
from the pin, and supply `connectionSettings` from either source.

**Per-client (fixed for the client's lifetime):**

```typescript
const client = RelayApi.createClient({
    url: "",
    connectionSettings: { tlsPin: { host: "10.0.0.4", port: 9600, fingerprint256: "ab:cd:…" } },
})
await client.someMethod(args)   // dials 10.0.0.4:9600, rejects any cert whose fingerprint differs
```

**Per-request (varies, via a middleware key):** a `GGConnectionSettingsKey` is a context key *and*
a transport middleware. Attach it to the schema and set its value inside the ambient request
context (the runtime establishes that context at the request boundary — don't create one per call):

```typescript
export const RELAY_CONN = new GGConnectionSettingsKey("relayConn")   // app owns it; make as many as needed
export const RelayApi = new GGHttpSchema({ contract, pathPrefix: "...", routes, use: [RELAY_CONN] })

// within the request scope:
RELAY_CONN.set({ tlsPin: { host, port, fingerprint256 } })
await client.someMethod(args)
```

Both sources merge into one bag; when both are set, the per-request `KEY.set(...)` wins. Repeated
calls to the same fingerprint pool one keep-alive agent; drop stale sockets after a restart with
`invalidateTlsPinAgent(fingerprint256)`.

> **Node only.** Browsers give JS no access to the TLS layer, so pinning is impossible there. A
> client created in a browser with non-empty `connectionSettings` (from either source) throws when
> a request is issued, rather than silently sending unpinned.

## WebSocket APIs

The websocket package documents the WS model in depth; this is the short version. A WS schema
follows the same object-config shape as HTTP: a `GGDuplexContract` (with `connect`,
`clientToServer`, `serverToClient`), a `path`, and an optional `use` array of wires.

### Defining WebSocket API

```typescript
import { GGWebSocketSchema } from "@grest-ts/websocket"
import { GGDuplexContract, IsObject, IsString, IsBoolean, GG_NO_PERMISSIONS, NOT_AUTHORIZED, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema"

export const IsItemMarkedEvent = IsObject({ item: IsItem, markedBy: IsString })
export type ItemMarkedEvent = typeof IsItemMarkedEvent.infer

export const IsUpdateItemRequest = IsObject({ item: IsItem, reason: IsString.orUndefined })
export const IsUpdateItemResponse = IsObject({ success: IsBoolean, message: IsString })

export const NotificationApiContract = new GGDuplexContract("NotificationApi", {
    connect: {
        errors: [NOT_AUTHORIZED, SERVER_ERROR],   // thrown at handshake (auth, etc.)
    },
    clientToServer: {
        updateItem: {
            input: IsUpdateItemRequest,
            success: IsUpdateItemResponse,
            errors: [VALIDATION_ERROR, SERVER_ERROR],
            permission: GG_NO_PERMISSIONS,
        },
        ping: { permission: GG_NO_PERMISSIONS },
    },
    serverToClient: {
        itemMarked: { input: IsItemMarkedEvent },
    },
})

export const NotificationApi = new GGWebSocketSchema({
    contract: NotificationApiContract,
    path: "ws/notifications",
    use: [USER_TOKEN_WIRE],        // same wire as the HTTP schemas — verified at handshake
})
```

The wire works identically on WebSocket: it reads + verifies the credential off the upgrade
handshake (the `.define()` handler runs once at connect). See `@grest-ts/websocket` for the
full WS auth + permissions model.

### WebSocket Server Handler

The handler is a `handleConnection(incoming, outgoing)` method. Type both params with
`typeof NotificationApi.clientToServer` / `serverToClient` — register incoming handlers with
`incoming.on({...})`, push to the client by calling methods on `outgoing`.

```typescript
export class NotificationService {
    private connections = new Set<typeof NotificationApi.serverToClient>()

    handleConnection = (incoming: typeof NotificationApi.clientToServer, outgoing: typeof NotificationApi.serverToClient): void => {
        const user = USER_DATA.get()   // durable principal minted by the wire at handshake
        this.connections.add(outgoing)
        outgoing.onClose(() => this.connections.delete(outgoing))

        incoming.on({
            updateItem: async (request) => ({ success: true, message: "Updated" }),
            ping: async () => {},
        })
    }

    // Broadcast a server→client push to every connection
    notifyAll(event: ItemMarkedEvent): void {
        for (const conn of this.connections) conn.itemMarked(event)
    }
}
```

### WebSocket in Runtime

WS schemas register on the same `GGHttp` builder via `.ws(Schema, handleConnection)` (use
`.wsRaw(...)` for an unstructured socket):

```typescript
import { GGHttp, GGHttpServer } from "@grest-ts/http"

protected compose(): void {
    const httpServer = new GGHttpServer()

    // One wire handler covers every schema that uses it — HTTP and WS alike.
    USER_TOKEN_WIRE_HANDLER.create(userService)

    new GGHttp(httpServer)
        .http(MyApi, myService)
        .ws(NotificationApi, notificationService.handleConnection)
}
```

### WebSocket Client

Same `Schema.createClient({url})` as HTTP. `connect()` opens the socket (its optional setup
callback registers `incoming.on({...})` handlers for server→client pushes); call
`client.outgoing.<method>(...)` to send.

```typescript
const client = NotificationApi.createClient({ url: "ws://localhost:3000" })

await client.connect(({ incoming }) => {
    incoming.on({
        itemMarked: async ({ item, markedBy }) => { /* handle server push */ },
    })
})

const res = await client.outgoing.updateItem({ item, reason: "Updated via UI" })

await client.disconnect()
```

