# grest-ts

TypeScript framework for building services around **contracts** — typed API definitions that serve as the single source of truth between client, server, and tests.

## Why grest-ts?

* **AI-era ready** — Clean, explicit service code is exactly what AI assistants thrive on — no magic to misunderstand, no hidden wiring to hallucinate about. And in an era where AI writes more of your
  code, integration tests are the one testing layer that actually gives you confidence it works end-to-end. Unit tests check pieces; integration tests prove the system.
* **Very fast** — `@grest-ts/schema` validation and serialization performs equally well compared to Typia — the fastest in the ecosystem. `@grest-ts/http` benchmarks close to fastify with logging
  disabled.
* **Contract-first** — Define your API once. Get typed server handlers, typed clients, and typed test utilities automatically.
* **Testing that survives refactors** — Integration tests at the contract level with per-request mocks and spies. Each test suite launches its own runtime instance with isolated ports and database —
  no shared state between suites. Mocks apply to exactly the request you specify, not globally.
* **Zero-config local dev** — `tsx src/MyRuntime.ts` and your service is running. Launch multiple services, discovery handles routing. Launch multiple instances, get load balancing.
* **Scalable** — From a single runtime to hundreds of microservices. Same patterns, same contracts, same tests. Service discovery is pluggable — built-in discovery handles local dev automatically,
  swap in your production implementation (Kubernetes, Consul, etc.) without changing service code.
* **No magic** — No DI containers, no decorators-as-wiring, no hidden resolution. Your Runtime's `compose()` is your bootstrap — all wiring visible in one place, plain constructors. Framework packages
  are thin layers over standard libraries (for example, mysql2, pg, vitest) — use them or bring your own.
* **Monorepo or multi-repo** — Run everything in one monorepo or split across multiple repos. The framework doesn't care — contracts are shared via packages (if you want to), choose the strategy that
  fits your team.
* **Tree-shakable** — Fully tree-shakable for minimal bundle sizes (for server package 400mb vs 5mb starts to matter at scale for release speeds)
* **Typed errors across boundaries** — Errors carry reference IDs, typed data, and flow across service boundaries as discriminated unions. `await` to throw, `.asResult()` to handle explicitly —
  callers choose per call site.
* **Extendable** — Testkit, config sources, loggers, metrics exporters — all pluggable. Or don't even use them if you like your own opensource version – they most likely work just fine.

### Purpose

Set the standard for your whole company — from zero to unicorn, you will be ready. Built from experience of doing exactly that.

### Current State

Being transparent: grest-ts is a new framework. Everything described here works — it's not a roadmap, it's shipped code.

The framework is designed by a developer who co-founded and scaled a tech company well past unicorn, solving the same infrastructure problems at every stage of growth.
grest-ts is the distillation of those lessons into a framework — what he wishes existed from day one.

It's currently battle-tested on one production project: a real estate management platform with real users and non-trivial complexity —
JWT auth with multi-level permissions, multi-tenancy, bank integrations, automated invoice processing,
expense documents parsing (pdf), S3 file management, SQS background jobs, bookkeeping system integrations,
audit logging, and a full React + Vite frontend consuming 100+ typed API contracts.
That's one project more than most frameworks have at launch, but still one project.
APIs may evolve, rough edges exist, and you'd be an early adopter. If that excites rather than scares you — welcome.
Fair warning though: once you get used to how testing works here, you'll miss it everywhere else.

---

## Getting Started

Copy the [`starter`](./starter) folder, rename it, and you have a working app:

```bash
# Start with a simple starter template
npm create @grest-ts/starter my-app

# Terminal 1 — server
cd server && npm run dev

# Terminal 2 — client
cd client && npm run dev
```

The starter is an npm workspaces monorepo with three packages:

- **api/** — shared contract definitions (used by both server and client)
- **server/** — backend implementation with integration tests
- **client/** — frontend (Vite + TypeScript, swap for whatever you prefer)

Everything is wired up — API contract, server handler, integration test, and a client that calls the API. Build on it.
(This structure is an example, you can restructure things however you like.)

---

## Quick Introduction

### 1. Define an API Contract

Contracts are the single source of truth. They define input/output types with runtime validation, error cases, and HTTP routes — all in one place.

```typescript
// api/src/api/ItemApi.ts
import {GGContractClass, IsObject, IsString, IsNumber, IsArray, VALIDATION_ERROR, NOT_FOUND, SERVER_ERROR} from "@grest-ts/schema"
import {httpSchema, GGRpc} from "@grest-ts/http"

export const IsItem = IsObject({
    id: IsNumber,
    title: IsString
})
export type Item = typeof IsItem.infer

export const IsCreateItemRequest = IsObject({
    title: IsString
})
export type CreateItemRequest = typeof IsCreateItemRequest.infer

export const ItemApiContract = new GGContractClass("ItemApi", {
    list: {
        success: IsArray(IsItem),
        errors: [SERVER_ERROR]
    },
    create: {
        input: IsCreateItemRequest,
        success: IsItem,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    }
})

export const ItemApi = httpSchema(ItemApiContract)
    .pathPrefix("api/items")
    .routes({
        list: GGRpc.GET("list"),
        create: GGRpc.POST("create")
    })
```

### 2. Implement It

```typescript
// server/src/services/ItemApiImpl.ts
export class ItemApiImpl {
    private items = new Map<number, Item>()
    private nextId = 1

    public list = async (): Promise<Item[]> => {
        return [...this.items.values()]
    }

    public create = async (input: CreateItemRequest): Promise<Item> => {
        const item = {id: this.nextId++, title: input.title}
        this.items.set(item.id, item)
        return item
    }
}
```

### 3. Wire It Up and Run

Your Runtime's `compose()` is your entire bootstrap — all wiring in one place, no hidden DI magic:

```typescript
// server/src/AppRuntime.ts
import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {ItemApi} from "@myapp/api/api/ItemApi"
import {ItemApiImpl} from "./services/ItemApiImpl"

export class AppRuntime extends GGRuntime {
    public static readonly NAME = "app"

    protected compose(): void {
        new GGHttp(new GGHttpServer())
            .http(ItemApi, new ItemApiImpl())
    }
}

AppRuntime.cli(import.meta.url).then()
```

```bash
tsx src/AppRuntime.ts    # That's it. Service is running.
```

### 4. Test It

```typescript
// server/test/integration/item.test.ts
import {GGTest} from "@grest-ts/testkit"
import {AppRuntime} from "../../src/AppRuntime"
import {ItemApi} from "@myapp/api/api/ItemApi"

describe("Item API", () => {
    GGTest.startWorker(AppRuntime)

    const ctx = new TestContext("Items")
        .apis({item: ItemApi})

    test("create and list items", async () => {
        await ctx.item.create({title: "Buy groceries"})
            .toMatchObject({id: 1, title: "Buy groceries"})

        await ctx.item.list()
            .toHaveLength(1)
    })
})
```

```bash
vitest    # Tests start the runtime in a worker thread with isolated ports.
```

---

## Testing

Testing is the core design principle of grest-ts. Tests work at the **contract level** — they call the same typed API that your clients use, so they survive internal refactors without changes.

You can still write unit tests and component tests as usual — grest-ts just makes integration tests as easy to write as unit tests. No complicated bootstrapping: your Runtime already knows how to set
everything up, so tests just start it and go.

### Test Isolation

Each test suite gets its own runtime instance with its own ports. This means:

- **Tests run in parallel** without interfering with each other
- **Your dev server stays running** while tests execute — no port conflicts, no shared state
- **Database cloning** gives each test suite a fresh database copy automatically

```typescript
describe("My tests", () => {
    GGTest.startWorker(AppRuntime)

    // Each test suite gets its own cloned database
    GGTest.with(AppConfig.postgres).clone({
        from: localConfig.postgres,
        seedFiles: ["./test/seed/data.sql"]
    })

    // Tests here run against an isolated runtime + database
})
```

### @mockable — Mock Anything in Tests

Mark any class with `@mockable` and it becomes controllable in tests — not just API contracts, any internal service:

```typescript
// server/src/services/AddressResolverService.ts
import {mockable} from "@grest-ts/testkit-runtime"

@mockable
export class AddressResolverService {
    async resolveAddress(address: string): Promise<LatLng> {
        // Calls a real geocoding API in production
        return await this.geocodingClient.resolve(address)
    }
}
```

In tests, `mockOf()` controls what that class returns — scoped to a single request, not global:

```typescript
test("resolves address when adding item", async () => {
    await ctx.checklist.add({title: "Visit Times Square"})
        .with(mockOf(AddressResolverService).resolveAddress
            .toEqual({address: "Times Square, NYC"})
            .andReturn({lat: 40.7580, lng: -73.9855})
        )
        .toMatchObject({title: "Visit Times Square", lat: 40.7580})
})
```

This works for anything — payment gateways, email senders, external API wrappers, file storage. Put `@mockable` on the class, mock it per-request in tests.

**Why this is different from `jest.mock`:** Most mocking libraries replace modules globally — every test in the file shares the same mock, and parallel tests can interfere with each other. Here, mocks
are scoped to a single request via `AsyncLocalStorage`. Two tests running in parallel with different mocks on the same service will never conflict. And in production, `@mockable` has zero overhead —
the decorator checks for test context and if there isn't one (production), it calls the original method directly with no wrapping cost.

### @testable — Call Any Class Directly

`@mockable` lets you control what services return. `@testable` goes further — it lets you **call any class directly** from tests, bypassing the API layer entirely. No dependency injection, no wiring setup. The runtime already assembled your object graph in `compose()`, `@testable` just gives your tests a handle to any class in it.

```typescript
@testable
@mockable
export class WeatherService {
    async getWeather(city: string): Promise<WeatherData> {
        return await this.weatherClient.fetch(city)
    }
}
```

Now tests can call `WeatherService` directly — and still use `@mockable` to control anything it depends on:

```typescript
import {callOn, mockOf} from "@grest-ts/testkit"

describe("WeatherService", () => {
    GGTest.startWorker(AppRuntime)

    test("call getWeather directly on the real, composed instance", async () => {
        const weather = await callOn(WeatherService).getWeather("Miami")
        expect(weather.temperature).toBe(72)
    })

    test("call it directly, but mock what it calls internally", async () => {
        await callOn(WeatherService)
            .getWeather("Alaska")
            .with(
                mockOf(ExternalWeatherClient).fetch
                    .andReturn({temperature: -10, condition: "blizzard"})
            )
            .toMatchObject({temperature: -10, condition: "blizzard"})
    })
})
```

This gives you testing at any granularity — API-level integration tests, service-level tests, or anything in between — all against the real composed object graph, not test doubles. Combined with `@mockable`, you can test any class while controlling exactly what its dependencies return, per request.

### Spies

Verify that services were called correctly without changing their behavior:

```typescript
test("notifies on item creation", async () => {
    await ctx.item.create({title: "New item"})
        .with(spyOn(NotificationService).notify
            .toHaveBeenCalledWith({userId: ctx.user.id})
        )
})
```

### Multi-Service Testing

Start multiple runtimes in a single test to verify cross-service flows end-to-end:

```typescript
describe("Checklist with Blocker service", () => {
    GGTest.startWorker([ChecklistRuntime, BlockerRuntime])

    // Both services are running, communicating with each other,
    // fully isolated from your dev environment
})
```

---

## Service-to-Service Communication

Services communicate using the same typed contracts. One service creates a client from another service's API definition — full type safety, no manual HTTP calls:

```typescript
export class OrderRuntime extends GGRuntime {
    public static readonly NAME = "orders"

    protected compose(): void {
        // Create a typed client to the inventory service
        const inventoryClient = InventoryApi.createClient()

        const orderService = new OrderService(inventoryClient)

        new GGHttp(new GGHttpServer())
            .http(OrderApi, orderService)
    }
}
```

```typescript
// OrderService calls InventoryService with full type safety
export class OrderService {
    constructor(private inventory: InventoryApiClient) {
    }

    public create = async (input: CreateOrderRequest) => {
        const stock = await this.inventory.checkStock({itemId: input.itemId})
        // ...
    }
}
```

No hardcoded URLs needed — service discovery resolves everything locally and in production.

---

## Error Handling

Contracts define exactly which errors each method can return, with optional typed data per error:

```typescript
// Define custom errors in your contract
const INSUFFICIENT_FUNDS = ERROR.define("INSUFFICIENT_FUNDS", 422, IsObject({
    balance: IsNumber,
    required: IsNumber
}))

// Throw with structured data — reference ID and timestamp are added automatically
throw new INSUFFICIENT_FUNDS({balance: 50, required: 100})
```

Callers choose how to handle errors — `await` throws by default (simple path), or use `.asResult()` for a typed discriminated union:

```typescript
// Simple path: await throws on error, you get the success type directly
const item = await api.item.create({title: "Buy groceries"})

// Explicit path: handle errors by type
const result = await api.item.create({title: "Buy groceries"}).asResult()
if (result.success) {
    result.data  // Item
} else {
    result.error.type  // "VALIDATION_ERROR" | "SERVER_ERROR"
}
```

This works the same across service boundaries. When service A calls service B, service A gets a typed union of B's possible errors — not just "it might fail," but exactly *which* errors with their
typed data:

```typescript
const result = await this.inventory.checkStock({itemId: input.itemId})
    .asResult()

if (!result.success) {
    // result.error is a typed union: OUT_OF_STOCK | NOT_FOUND | SERVER_ERROR
    if (result.error.type === "OUT_OF_STOCK") {
        // result.error.data is typed: { available: number, requested: number }
    }
}
```

Error handling across service boundaries is as type-safe as a local function call. No need to choose between throwing and returning errors — callers decide per call site.

---

## Per-Request Context

`GGContextKey` gives you per-request state that's available anywhere in the call stack — no need to pass user, company, or trace data through every function.

### Define a context key

```typescript
// server/src/services/auth/UserContext.ts
import {GGContextKey} from "@grest-ts/context"

class UserContextKey extends GGContextKey<AuthUser> {
    public assurePermission(permission: UserPermission): void {
        const user = this.get()
        if (!user.permissions.includes(permission)) throw FORBIDDEN.error()
    }
}

export const UserContext = new UserContextKey("userData", IsAuthUser)
```

### Set it in middleware

```typescript
export class UserAuthMiddleware implements GGHttpServerMiddleware {
    async process(req: GGHttpRequest): Promise<void> {
        const token = req.headers["authorization"]
        const user = await this.verifyToken(token)
        UserContext.set(user)
    }
}
```

### Read it anywhere — no passing through parameters

```typescript
// Deep inside any service, handler, or utility
export class AuditLogApiImpl {
    public list = async (query: AuditLogQuery) => {
        const user = UserContext.get()           // Available anywhere in the request
        CompanyContext.assurePermission(CompanyUserPermission.auditLog)
        // ...
    }
}
```

The framework manages this via `AsyncLocalStorage`

---

## Configuration

`GGConfig` provides typed configuration with runtime validation. Define your config schema once, override locally for development, resolve from AWS Secrets Manager (or any source) in production.

### Define config schema

```typescript
// server/src/AppConfig.ts
import {GGConfig, GGResource, GGSecret} from "@grest-ts/config"
import {IsString} from "@grest-ts/schema"
import {GGMysqlConfig} from "@grest-ts/db-mysql"

export const AppConfig = GGConfig.define("/myapp/", () => ({
    appUrl: new GGResource("appUrl", IsString, "Frontend URL"),
    mysql: new GGMysqlConfig("db"),
    jwtSecret: new GGSecret("jwtSecret", IsString, "JWT signing key"),
}))
```

### Override locally for development

```typescript
// server/src/local.config.ts
import {createLocalConfig} from "@grest-ts/config"
import {AppConfig} from "./AppConfig"

export const localConfig = createLocalConfig(AppConfig, {
    appUrl: "http://localhost:3000",
    mysql: {
        host: {host: "localhost", port: 3306, database: "myapp"},
        user: {username: "root", password: ""},
    },
    jwtSecret: "dev-secret",
})
```

### Use in runtime

```typescript
export class AppRuntime extends GGRuntime {
    protected compose(): void {
        // Local config for dev, AWS Secrets Manager for production
        new GGConfigLocator(AppConfig, localConfig)
            .add([GGSecret, GGResource], new GGConfigStoreAwsSecretsManager({
                secretName: "myapp/prod", region: "eu-west-1"
            }))

        const db = new GGMysql(AppConfig.mysql)  // Typed, validated at startup
    }
}
```

### Watch config changes at runtime

Any config value can be watched. When the underlying source changes (e.g. a settings file is edited, credentials are rotated), your code reacts immediately:

```typescript
// React to timeout setting changes at runtime
AppConfig.settings.timeout.watch((newValue) => {
    GGLog.info(this, "Timeout changed", {newValue})
    this.requestTimeout = newValue
})
```

The framework uses this internally too — `GGMysql` watches database credentials and reconnects automatically when they change:

```typescript
// Inside @grest-ts/db-mysql — reconnects on credential rotation
this.config.host.watch(() => this.connect())
this.config.user.watch(() => this.connect())
```

`GGConfigStoreFile` auto-watches JSON files for changes on disk. Edit a settings file, your running service picks it up — no restart needed.

`GGResource` for infrastructure (URLs, buckets), `GGSecret` for sensitive values (keys, passwords), `GGSetting` for runtime-tunable settings. All typed, all validated, all watchable.

---

## Local Development

### Just Run It

```bash
tsx src/MyRuntime.ts
```

No Docker, no infrastructure setup for the service itself. The runtime handles port allocation, service registration, and graceful shutdown.

### Multiple Services

Launch each service in its own terminal. Service discovery finds them automatically:

```bash
# Terminal 1
tsx src/OrderRuntime.ts

# Terminal 2
tsx src/InventoryRuntime.ts

# OrderRuntime can now call InventoryRuntime — no config needed
```

### Multiple Instances

Launch the same runtime multiple times — the framework provides load balancing between instances via service discovery. Scale locally the same way you scale in production.

### Typed Clients in the Browser

The same API contracts work in browser apps. Create a typed client and call your server with full type safety:

```typescript
import {GGHttpClientConfig} from "@grest-ts/http"
import {ItemApi} from "@myapp/api/api/ItemApi"

const client = ItemApi.createClient({url: ""})
const items = await client.list()  // Fully typed
```

---

## Package Reference

All packages below are published to npm under `@grest-ts/*`.

### Core

| Package                                                               | Purpose                                                   |
|-----------------------------------------------------------------------|-----------------------------------------------------------|
| [`@grest-ts/runtime`](./packages/runtime)                             | Service bootstrap and lifecycle                           |
| [`@grest-ts/schema`](./packages/schema/schema)                        | Type-safe validation, branded types, contract definitions |
| [`@grest-ts/http`](./packages/http/http)                              | HTTP/WebSocket client and server                          |
| [`@grest-ts/websocket`](./packages/http/websocket)                    | WebSocket server and client (Node.js + browser)           |
| [`@grest-ts/config`](./packages/config/config)                        | Configuration management — resources, secrets, settings   |
| [`@grest-ts/config-aws`](./packages/config/config-aws)                | AWS Secrets Manager adapter for config                    |
| [`@grest-ts/context`](./packages/context)                             | Async context for per-request state                       |
| [`@grest-ts/locator`](./packages/locator)                             | Service locator with lifecycle management                 |
| [`@grest-ts/common`](./packages/common)                               | Shared utilities and types                                |
| [`@grest-ts/logger`](./packages/logger/logger)                        | Structured logging                                        |
| [`@grest-ts/discovery`](./packages/discovery/discovery)               | Service discovery interface and load balancing            |
| [`@grest-ts/discovery-local`](./packages/discovery/discovery-local)   | Local dev discovery (auto-finds services, zero config)    |
| [`@grest-ts/discovery-static`](./packages/discovery/discovery-static) | Static service discovery (fixed ports via config)         |
| [`@grest-ts/ipc`](./packages/ipc)                                     | Inter-process communication (framework internal)          |

Local development uses built-in discovery automatically — services find each other with zero configuration. For production, implement the discovery interface for your infrastructure (Kubernetes,
Consul, AWS Cloud Map, etc.). The adapter is a thin layer; the rest of your code doesn't change.

### Testing

Many packages provide testkit utilities making testing easier. These are

| Package                                                                   | Purpose                                     |
|---------------------------------------------------------------------------|---------------------------------------------|
| [`@grest-ts/testkit`](./packages-tooling/testkit/testkit)                 | Integration testing — GGTest, mockOf, spyOn |
| [`@grest-ts/testkit-runtime`](./packages-tooling/testkit/testkit-runtime) | Runtime support for @mockable and @testable  |
| [`@grest-ts/testkit-vitest`](./packages-tooling/testkit/testkit-vitest)   | Vitest integration and global setup         |

### Observability (All optional)

| Package                                                        | Purpose                              |
|----------------------------------------------------------------|--------------------------------------|
| [`@grest-ts/logger-console`](./packages/logger/logger-console) | Console logger implementation        |
| [`@grest-ts/metrics`](./packages/metrics)                      | Prometheus-style application metrics |
| [`@grest-ts/trace`](./packages/trace/trace)                    | Distributed tracing                  |
| [`@grest-ts/trace-http`](./packages/trace/trace-http)          | HTTP tracing integration             |

### Database (All optional)

| Package                                                 | Purpose                                   |
|---------------------------------------------------------|-------------------------------------------|
| [`@grest-ts/db-mysql`](./packages-libs/db/db-mysql)     | MySQL utilities (thin layer over mysql2)  |
| [`@grest-ts/db-postgre`](./packages-libs/db/db-postgre) | PostgreSQL utilities (thin layer over pg) |
| [`@grest-ts/sql`](./packages-libs/sql)                  | Type-safe SQL query builder               |

### Files (All optional)

| Package                                            | Purpose                                                                                                                     |
|----------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| [`@grest-ts/file`](./packages/schema/file)         | File abstraction                                                                                                            |
| [`@grest-ts/file-http`](./packages/http/file-http) | HTTP file upload/download codec for simple "through the node" cases. (We recommend use direct uploads/downloads to/from S3) |

### Utilities (All optional)

| Package                                      | Purpose                                         |
|----------------------------------------------|-------------------------------------------------|
| [`@grest-ts/struct`](./packages-libs/struct) | Binary struct serialization and code generation |

---

## Design Principles

* **Contract-first, transport-agnostic** — APIs are typed contracts, then bound to HTTP/WebSocket. Same contract generates server, client, and tests.
* **No magic, no DI framework** — `compose()` is your bootstrap. Plain constructors, all wiring visible in one place. No hidden resolution, no decorators-as-injection.
* **Per-request context** — `GGContextKey` provides per-request state anywhere in the call stack via AsyncLocalStorage. No parameter threading.
* **@mockable anything** — Decorate any class, mock or spy on it per-request in tests. Not global, survives refactors. Zero production overhead.
* **@testable — test at any depth** — Call any class directly from tests against the real composed object graph. No DI gymnastics, no test doubles — just reach into your running service and invoke the method you want to test, with full `@mockable` control over its dependencies.
* **Typed errors everywhere** — Errors carry reference IDs, typed data, and flow across service boundaries as discriminated unions. Callers choose: `await` to throw, `.asResult()` to handle
  explicitly.
* **Watchable config** — Any setting, secret, or resource can be watched. Change a file, rotate credentials — your service reacts without restart.
* **Event-driven communication** — Services talk via typed HTTP clients, WebSockets, or async events (SNS/SQS).
* **Metrics-instrumented** — Built-in Prometheus-style metrics for observability.

---

## Extending the Framework

- [Creating framework packages](./README-extending.md) — How to add new packages to the framework

