# grest-ts coding rules

grest-ts is a **contract-first** TypeScript framework. The pattern is always:
1. Define a contract → 2. Implement it → 3. Wire in a Runtime → 4. Test with GGTest

Never generate Express / NestJS / Fastify patterns. Never use decorators for routing or DI. Never use `req`/`res` objects. All wiring lives in `compose()`.

---

## 1. Contracts

Contracts live in a shared `api/` package, imported by both server and client.

```typescript
// api/src/api/ItemApi.ts
import {GGContractClass, IsObject, IsString, IsBoolean, IsArray, IsUint, NOT_FOUND, VALIDATION_ERROR, SERVER_ERROR} from "@grest-ts/schema"
import {httpSchema, GGRpc} from "@grest-ts/http"

// --- Type schemas ---
export const IsItem = IsObject({
    id: IsUint,
    title: IsString,
    done: IsBoolean,
})
export type Item = typeof IsItem.infer

export const IsCreateItemRequest = IsObject({
    title: IsString.nonEmpty,
})
export type CreateItemRequest = typeof IsCreateItemRequest.infer

// --- Contract ---
export const ItemApiContract = new GGContractClass("ItemApi", {
    list: {
        success: IsArray(IsItem),
        errors: [SERVER_ERROR],
    },
    get: {
        input: IsObject({id: IsUint}),
        success: IsItem,
        errors: [NOT_FOUND, SERVER_ERROR],
    },
    create: {
        input: IsCreateItemRequest,
        success: IsItem,
        errors: [VALIDATION_ERROR, SERVER_ERROR],
    },
    delete: {
        input: IsObject({id: IsUint}),
        errors: [NOT_FOUND, SERVER_ERROR],
    },
})

// --- HTTP binding ---
export const ItemApi = httpSchema(ItemApiContract)
    .pathPrefix("api/items")
    .routes({
        list:   GGRpc.GET("list"),
        get:    GGRpc.GET("get/:id"),
        create: GGRpc.POST("create"),
        delete: GGRpc.DELETE("delete/:id"),
    })
```

**Rules:**
- `GGContractClass(name, methods)` — first arg is a string name, second is a map of method definitions.
- Every method must have at least `errors`. `input` and `success` are optional.
- `success` with no value means the method returns `void`.
- `httpSchema(...).pathPrefix(...).routes({...})` — every route key must match a method key in the contract.
- HTTP verbs: `GGRpc.GET`, `GGRpc.POST`, `GGRpc.PUT`, `GGRpc.DELETE`.
- GET/DELETE: input fields become query params (or path params when named in path with `:param`).
- POST/PUT: input becomes JSON body.
- Export both `IsXxx` validators (for reuse) and inferred `type Xxx = typeof IsXxx.infer`.

---

## 2. Custom errors

```typescript
import {ERROR, IsObject, IsNumber} from "@grest-ts/schema"

// No data, HTTP 400
const INVALID_COUPON = ERROR.badRequest("INVALID_COUPON")

// With typed data, HTTP 400
const INSUFFICIENT_FUNDS = ERROR.badRequest("INSUFFICIENT_FUNDS", IsObject({
    required: IsNumber,
    available: IsNumber,
}))

// Custom status code
const RATE_LIMITED = ERROR.define("RATE_LIMITED", 429)

// Throw in implementation
throw new INVALID_COUPON()
throw new INSUFFICIENT_FUNDS({required: 100, available: 50})
throw new INSUFFICIENT_FUNDS({required: 100, available: 50}, {displayMessage: "Not enough funds"})
```

**Standard errors** (import from `@grest-ts/schema`):
- `VALIDATION_ERROR` (422) — input schema failed; auto-thrown by framework
- `NOT_FOUND` (404)
- `NOT_AUTHORIZED` (401)
- `FORBIDDEN` (403)
- `EXISTS` (409)
- `BAD_REQUEST` (400)
- `SERVER_ERROR` (500) — always include in every method's `errors` array

**Error constructor context** (optional second arg):
```typescript
throw new NOT_FOUND({displayMessage: "Item not found", ref: "my-ref", debugMessage: "db row missing"})
```

---

## 3. Implementation

The implementation is a **plain class** — no base class, no decorators for routing.
Method signatures must match what the contract expects.

```typescript
// server/src/services/ItemApiImpl.ts
import type {CreateItemRequest, Item} from "@myapp/api/api/ItemApi"
import {NOT_FOUND} from "@grest-ts/schema"

export class ItemApiImpl {
    private items = new Map<number, Item>()
    private nextId = 1

    public list = async (): Promise<Item[]> => {
        return [...this.items.values()]
    }

    public get = async ({id}: {id: number}): Promise<Item> => {
        const item = this.items.get(id)
        if (!item) throw new NOT_FOUND()
        return item
    }

    public create = async (input: CreateItemRequest): Promise<Item> => {
        const item: Item = {id: this.nextId++, title: input.title, done: false}
        this.items.set(item.id, item)
        return item
    }

    public delete = async ({id}: {id: number}): Promise<void> => {
        if (!this.items.has(id)) throw new NOT_FOUND()
        this.items.delete(id)
    }
}
```

**Rules:**
- Methods are arrow functions assigned as class properties (not prototype methods), so `this` is always bound.
- Signature for methods with input: `(input: InputType) => Promise<SuccessType>`
- Signature for methods without input: `() => Promise<SuccessType>`
- Signature for void methods: `(...) => Promise<void>`
- Dependencies are passed via constructor — no DI container, no service locator in production code.
- The class does NOT extend or implement any framework type — the framework infers compatibility structurally.

---

## 4. Runtime — compose()

All wiring lives in `compose()`. No DI, no hidden resolution.

```typescript
// server/src/AppRuntime.ts
import {GGRuntime} from "@grest-ts/runtime"
import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GG_LOG} from "@grest-ts/logger"
import {GGLoggerConsole} from "@grest-ts/logger-console"
import {ItemApi} from "@myapp/api/api/ItemApi"
import {ItemApiImpl} from "./services/ItemApiImpl"

export class AppRuntime extends GGRuntime {
    public static readonly NAME = "app"   // used for service discovery

    protected compose(): void {
        GG_LOG.get().addLogger(new GGLoggerConsole({showData: true}))

        const httpServer = new GGHttpServer()

        new GGHttp(httpServer)
            .http(ItemApi, new ItemApiImpl())
    }
}

AppRuntime.cli(import.meta.url).then()
```

**Rules:**
- `extends GGRuntime`, override `compose()`.
- `public static readonly NAME` — required, identifies the service for discovery.
- `new GGHttpServer()` — creates an HTTP server (auto-assigns port).
- `new GGHttp(httpServer).http(ApiSchema, implementation)` — binds contract to implementation.
- Chain `.http(...)` calls on the same `GGHttp` instance to register multiple APIs on the same server.
- `AppRuntime.cli(import.meta.url).then()` — entry point; starts the runtime when run directly.
- Use `tsx src/AppRuntime.ts` to run locally.

### Multiple APIs / middleware

```typescript
protected compose(): void {
    const httpServer = new GGHttpServer()

    // Public routes (no auth)
    new GGHttp(httpServer)
        .http(PublicApi, new PublicApiImpl())

    // Authenticated routes
    new GGHttp(httpServer)
        .use(new UserAuthMiddleware(userService))
        .http(ItemApi, new ItemApiImpl(db))
        .http(UserApi, userService)
}
```

### Service-to-service client

```typescript
protected compose(): void {
    // Create a typed client to another service (uses service discovery)
    const inventoryClient = InventoryApi.createClient()

    const orderService = new OrderService(inventoryClient)

    new GGHttp(new GGHttpServer())
        .http(OrderApi, orderService)
}
```

---

## 5. Integration tests

```typescript
// server/test/integration/item.test.ts
import {GGTest} from "@grest-ts/testkit"
import {AppRuntime} from "../../src/AppRuntime"
import {ItemApi} from "@myapp/api/api/ItemApi"
import {TestContext} from "../TestContext"

describe("Item API", () => {
    GGTest.startWorker(AppRuntime)   // starts the runtime in a worker thread, isolated port

    const ctx = new TestContext("Items")
        .apis({item: ItemApi})        // registers typed client as ctx.item

    test("create item", async () => {
        await ctx.item.create({title: "Buy groceries"})
            .toMatchObject({id: 1, title: "Buy groceries", done: false})
    })

    test("get missing item", async () => {
        await ctx.item.get({id: 999})
            .toBeError(NOT_FOUND)
    })

    test("list is empty initially", async () => {
        await ctx.item.list()
            .toHaveLength(0)
    })
})
```

### TestContext file (extend for auth helpers)

```typescript
// server/test/TestContext.ts
import {GGTestContext} from "@grest-ts/testkit"

export class TestContext extends GGTestContext {}
```

```typescript
// With auth
export class TestContext extends GGTestContext {
    public async login(credentials: LoginRequest) {
        const result = await this.callOn(AuthApi).login(credentials)
        this.set(AUTH_TOKEN, result.token)
        return result
    }
}
```

### Assertion chain

All `ctx.api.method(...)` calls return a `GGTestAction` (PromiseLike). Assertions run on `await`.

```typescript
// Data assertions
await ctx.item.get({id: 1}).toEqual({id: 1, title: "foo", done: false})
await ctx.item.get({id: 1}).toMatchObject({title: "foo"})
await ctx.item.list().toHaveLength(3)
await ctx.item.list().arrayToContain({title: "foo"})
await ctx.item.delete({id: 1}).toBeUndefined()

// Error assertions
await ctx.item.get({id: 999}).toBeError(NOT_FOUND)
await ctx.item.create({title: ""}).toBeError(VALIDATION_ERROR).toMatchObject({
    title: {__issue: {message: "Value must not be empty"}}
})

// Chain with interceptors (mocks, spies) — see §6
await ctx.item.create({title: "foo"})
    .with(mockOf(GeocodeService).resolve.andReturn({lat: 0, lng: 0}))
    .toMatchObject({title: "foo"})
```

### Lifecycle hooks

```typescript
const alice = new TestContext("Alice")
    .apis({item: ItemApi})
    .beforeAll(async () => {
        await alice.login({username: "alice", password: "secret"})
    })
    .beforeEach(async () => { /* reset state */ })
    .resetAfterEach()   // resets context headers/state after each test
```

### Database cloning

```typescript
describe("my tests", () => {
    GGTest.startWorker(AppRuntime)

    GGTest.with(AppConfig.mysql).clone({
        from: localConfig.mysql,
        seedFiles: ["./test/seed/data.sql"],
    })
    // Each test suite gets its own schema clone; auto-cleaned up after.
})
```

### Multi-service test

```typescript
describe("cross-service flow", () => {
    GGTest.startWorker([OrderRuntime, InventoryRuntime])
    // Both services run and discover each other automatically.
})
```

---

## 6. @mockable and mockOf

This is the most important pattern AI tools consistently get wrong. Read carefully.

### Mark a class as mockable

```typescript
// server/src/services/GeocoderService.ts
import {mockable} from "@grest-ts/testkit-runtime"

@mockable
export class GeocoderService {
    async resolveAddress(address: string): Promise<{lat: number, lng: number}> {
        return await this.geocodingApi.lookup(address)
    }
}
```

**Rules:**
- Import `mockable` from `@grest-ts/testkit-runtime` (not `@grest-ts/testkit`).
- Only **async** methods are interceptable (sync methods are not wrapped).
- Zero production overhead — the wrapper only activates when a test context is present.
- The decorator goes on the production class. It is safe to ship to production.

### Use mockOf in tests

```typescript
import {mockOf, spyOn} from "@grest-ts/testkit"
// NOT from "@grest-ts/testkit-runtime"

test("mock external geocoder", async () => {
    await ctx.item.create({title: "Visit Times Square", address: "Times Square"})
        .with(
            mockOf(GeocoderService).resolveAddress
                .toEqual({address: "Times Square"})          // assert input
                .andReturn({lat: 40.758, lng: -73.985})      // return fake data
        )
        .toMatchObject({lat: 40.758})
})

test("spy — call through but validate", async () => {
    await ctx.item.create({title: "Visit Times Square", address: "Times Square"})
        .with(
            spyOn(GeocoderService).resolveAddress
                .toEqual({address: "Times Square"})              // assert input
                .responseToMatchObject({lat: 40.758})            // assert real response
        )
})
```

**Rules:**
- `mockOf(ServiceClass).methodName` — creates a mock interceptor for that method.
- `.toEqual(...)` / `.toMatchObject(...)` after `mockOf(S).method` — validates the input the mock received.
- `.andReturn(value)` — the mock returns this value instead of calling real code.
- `.andReturn(new MY_ERROR())` — mock returns an error.
- `.times(n)` — expect exactly n calls.
- `.sleep(ms)` — add delay before returning.
- `spyOn(S).method` — calls real method but validates input/output.
- `.responseToMatchObject(...)` — on a spyOn interceptor, validates the real return value.
- Mocks are **scoped to the single request** via AsyncLocalStorage — parallel tests never interfere.
- `.with(interceptor)` accepts a single interceptor or an array of interceptors.

### @testable — call any class directly from tests

```typescript
// server/src/services/WeatherService.ts
import {testable} from "@grest-ts/testkit-runtime"
import {mockable} from "@grest-ts/testkit-runtime"

@testable
@mockable
export class WeatherService {
    async getWeather(city: string): Promise<WeatherData> {
        return await this.weatherClient.fetch(city)
    }
}
```

```typescript
// In tests
import {callOn, mockOf} from "@grest-ts/testkit"

test("call WeatherService directly", async () => {
    await callOn(WeatherService)
        .getWeather("Miami")
        .toMatchObject({temperature: expect.any(Number)})
})

test("call with mock on dependency", async () => {
    await callOn(WeatherService)
        .getWeather("Alaska")
        .with(mockOf(ExternalWeatherClient).fetch.andReturn({temperature: -10}))
        .toMatchObject({temperature: -10})
})
```

**Rules:**
- `@testable` registers the instance in GGLocator at construction time (during `compose()`).
- `callOn(ServiceClass).method(...)` returns a `GGTestAction` — same assertion chain as API calls.
- Combine `@testable` + `@mockable` for full testing control at any depth.

---

## 7. GGSchemaDocs — `.docs()`

Every schema supports `.docs({title, description, example})`. Use this for OpenAPI documentation and IDE hints. AI tools almost always omit this — add it when building reusable schemas.

```typescript
export const IsUserId = IsInt.brand("UserId").docs({
    title: "User ID",
    description: "Unique identifier for a user",
    example: 42,
})

export const IsEmail = IsString
    .refine(isValidEmail, emailError)
    .brand("email")
    .docs({
        title: "Email address",
        example: "user@example.com",
    })

export const IsTimestamp = IsInt.range(0, 32503680000).brand("timestamp").docs({
    title: "Unix timestamp in seconds",
    description: "year 1970-3000",
})

export const IsSearchRequest = IsObject({
    term: IsString.nonEmpty.docs({title: "Search term", example: "coffee"}),
    page: IsUint.orUndefined.docs({title: "Page number (1-based)", example: 1}),
    limit: IsUint.orUndefined.docs({title: "Results per page", example: 20}),
})
```

`.docs()` can be chained on any schema: `IsString`, `IsNumber`, `IsObject`, `IsArray`, `IsUnion`, branded types, etc.

---

## 8. Per-request context

Use `GGContextKey` for data that must be accessible anywhere in the call stack without parameter threading.

```typescript
// server/src/auth/UserContext.ts
import {GGContextKey} from "@grest-ts/context"
import {IsObject, IsString} from "@grest-ts/schema"

const IsAuthUser = IsObject({id: IsString, role: IsString})
export type AuthUser = typeof IsAuthUser.infer

export const UserContext = new GGContextKey<AuthUser>("userData", IsAuthUser)
```

```typescript
// Set in middleware
export class UserAuthMiddleware implements GGHttpTransportMiddleware {
    parseRequest(req: GGHttpRequest): void {
        const user = this.verifyToken(req.headers["authorization"])
        UserContext.set(user)
    }
}
```

```typescript
// Read anywhere — no parameter threading needed
export class AuditService {
    async log(action: string): Promise<void> {
        const user = UserContext.get()   // available anywhere in the request
        await this.db.audit.insert({userId: user.id, action})
    }
}
```

---

## 9. Typed client (browser / other services)

```typescript
import {ItemApi} from "@myapp/api/api/ItemApi"

// Browser same-origin
const client = ItemApi.createClient({url: ""})

// Explicit URL
const client = ItemApi.createClient({url: "http://localhost:3000"})

// Service-to-service (uses service discovery — no URL needed)
const client = ItemApi.createClient()

// Calling
const items = await client.list()
const item  = await client.get({id: 1})

// Explicit error handling
const result = await client.create({title: "foo"}).asResult()
if (result.success) {
    result.data   // Item
} else {
    result.error.type  // "VALIDATION_ERROR" | "SERVER_ERROR"
}

// Fallback
const item = await client.get({id: 1}).orDefault(() => defaultItem)
```

---

## 10. Validation & errors

**The contract is the validator.** Put every field rule in the input schema. The framework validates input *before* your handler runs and auto-throws `VALIDATION_ERROR` with a per-field issue map. Re-checking the same rules in the impl and throwing `BAD_REQUEST` produces a generic, unmapped error — don't do it.

```typescript
// ❌ Hand-validating in the impl — generic error, no field mapping
public create = async (input: CreateItemRequest): Promise<Item> => {
    if (!input.title) throw new BAD_REQUEST()   // unmapped, can't point at `title`
    ...
}

// ✅ Rule in the schema — auto VALIDATION_ERROR, mapped to the field
export const IsCreateItemRequest = IsObject({
    title: IsString.nonEmpty,
})
```

`VALIDATION_ERROR` is field-mapped; `BAD_REQUEST` thrown from an impl is a generic business error. Reserve `BAD_REQUEST` for impl-level business rules that can't live in the schema, not for input shape.

### `VALIDATION_ERROR` must be declared in `errors`

It is **not** implicit. If a method's `errors` list omits `VALIDATION_ERROR`, the framework can't send it — when it tries, `getResponseSchema` rejects the unlisted type and coerces it to `SERVER_ERROR` ("Tried to reply with not listed error code!"), so per-field info is lost on the wire.

```typescript
// ❌ input present but VALIDATION_ERROR missing → field errors arrive as SERVER_ERROR
create: {input: IsCreateItemRequest, success: IsItem, errors: [SERVER_ERROR]}
// ✅
create: {input: IsCreateItemRequest, success: IsItem, errors: [VALIDATION_ERROR, SERVER_ERROR]}
```

The same rule applies to every error: an error not in the route's `errors` list is coerced to `SERVER_ERROR`.

### Required must be type-level — `.orUndefined` short-circuits `refine`

When a value is `undefined`, `.orUndefined` returns before the refinement loop runs. So `.orUndefined.refine(isRequired)` never fires — you cannot recover a required constraint with a refine.

```typescript
// ❌ refine never runs when the value is undefined
field: IsString.orUndefined.refine(v => v.length > 0, err)
// ✅ required at the type level
field: IsString.nonEmpty
```

If a field's requiredness genuinely differs between create and update, model them as **two schemas** that each match their reality — don't make one schema optional-everywhere and patch with refines.

```typescript
export const IsCreateItemRequest = IsObject({title: IsString.nonEmpty})
export const IsUpdateItemRequest = IsObject({title: IsString.nonEmpty.orUndefined})
```

### Custom per-field messages

`refine()` emits a **single** issue at the schema's own path — there is no zod-style `addIssue({path})` for targeting a sub-field. For a custom message on a pattern check, pass a `GGIssueInvalid` as the second arg to `regex` (replaces the generic "Value does not match required pattern"):

```typescript
import {IsString, GGIssueInvalid} from "@grest-ts/schema"

const IsSlug = IsString.regex(/^[a-z0-9-]+$/, new GGIssueInvalid("invalid_slug", "Lowercase letters, digits and dashes only"))
```

### `typeof IsX.infer`, never a parallel interface

Export the inferred type from the validator. Never hand-write a matching `interface` — it drifts from the schema silently.

```typescript
export const IsItem = IsObject({id: IsUint, title: IsString})
export type Item = typeof IsItem.infer   // ✅
// ❌ interface Item { id: number; title: string }  — drifts from IsItem
```

### Client-side error handling

- `e.message` is the **error type string** (e.g. `"NOT_FOUND"`) — the `ERROR` constructor calls `super(type)`. The human-readable text is at `e.context.displayMessage`. Use `e?.context?.displayMessage || e?.message` as the fallback.
- Detect a specific error with the static guard `MyError.is(e)` — this only matches if `MyError` is in that route's `errors` list (otherwise it arrived coerced to `SERVER_ERROR` and won't match).

### New-error checklist

1. `ERROR.define(...)` (or `ERROR.badRequest(...)`) in `errors.ts`.
2. Confirm the package index re-exports `./errors`.
3. **Add it to every route's `errors` list that can throw it** — this is the silent fail point; skip it and the error is coerced to `SERVER_ERROR`.
4. `throw new MyError(...)` server-side; detect with `MyError.is(e)` client-side.

### Schema evolution is a wire-contract migration

Response validation runs on **every outbound payload** (`parseOutputData` → `SERVER_ERROR` "Response validation failed!" on mismatch). Making a field required is therefore a data migration, not a local change:

- Existing stored rows missing the field fail **response** validation on read and surface as `SERVER_ERROR` to the client.
- Untyped DB writes / fixtures won't compile-error, so backfill seeds explicitly.
- Tests asserting `BAD_REQUEST` for what is now a schema constraint must be updated to assert `VALIDATION_ERROR` — the schema rejects before the impl runs.

### Single-copy package loading

`@grest-ts/schema` enforces single-copy loading via an internal dedup guard and throws `"[@grest-ts/schema] Duplicate package load detected"` when two copies load in one process — e.g. a consumer symlinks a dependency that ships its own `node_modules/@grest-ts/schema`. Deduplicate the package in your module resolution; two copies break async context, validation, and error identity across the boundary.

---

## 11. Package locations

| What | Package | Import |
|---|---|---|
| Schema validators, contract, errors | `@grest-ts/schema` | `IsObject`, `IsString`, `GGContractClass`, `ERROR`, `NOT_FOUND`, … |
| HTTP binding & client | `@grest-ts/http` | `httpSchema`, `GGRpc`, `GGHttp`, `GGHttpServer` |
| Runtime bootstrap | `@grest-ts/runtime` | `GGRuntime` |
| Test framework | `@grest-ts/testkit` | `GGTest`, `GGTestContext`, `mockOf`, `spyOn`, `callOn` |
| @mockable / @testable decorators | `@grest-ts/testkit-runtime` | `mockable`, `testable` |
| Per-request context | `@grest-ts/context` | `GGContextKey` |
| Config management | `@grest-ts/config` | `GGConfig`, `GGResource`, `GGSecret` |
| Logging | `@grest-ts/logger`, `@grest-ts/logger-console` | `GG_LOG`, `GGLoggerConsole` |
| WebSocket | `@grest-ts/websocket` | `defineSocketContract`, `webSocketSchema` |
| MySQL | `@grest-ts/db-mysql` | `GGMysql`, `GGMysqlConfig` |
| PostgreSQL | `@grest-ts/db-postgre` | `GGPostgre` |

---

## 12. Anti-patterns — never generate these

```typescript
// ❌ Express / raw HTTP
app.get("/api/items", (req, res) => { ... })

// ❌ NestJS decorators
@Controller("items") @Get() @Injectable()

// ❌ DI container / service locator in production code
@Injectable() constructor(@Inject(TOKEN) private svc: Service) {}

// ❌ Implementing a named interface instead of letting TS infer
class ItemApiImpl implements IItemApi { ... }

// ❌ Prototype methods in implementations (breaks `this` binding)
public async list(): Promise<Item[]> { ... }
// ✅ Arrow function properties instead:
public list = async (): Promise<Item[]> => { ... }

// ❌ Global mocks (jest.mock / vitest.mock)
jest.mock("./GeocoderService")

// ❌ Missing SERVER_ERROR in contract errors
errors: [NOT_FOUND]
// ✅ Always include SERVER_ERROR:
errors: [NOT_FOUND, SERVER_ERROR]

// ❌ Importing mockable from testkit
import {mockable} from "@grest-ts/testkit"
// ✅ mockable lives in testkit-runtime:
import {mockable} from "@grest-ts/testkit-runtime"

// ❌ Importing mockOf from testkit-runtime
import {mockOf} from "@grest-ts/testkit-runtime"
// ✅ mockOf lives in testkit:
import {mockOf} from "@grest-ts/testkit"
```
