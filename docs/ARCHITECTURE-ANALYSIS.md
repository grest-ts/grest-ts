# grest-ts Architecture Analysis

## What is grest-ts?

grest-ts is a TypeScript framework for building backend services. Its core value proposition is **contracts + testing** — a pattern for how services should be defined, composed, and tested. It is NOT competing with Fastify, NestJS, or Zod. It operates at a layer above, defining how your stuff fits together and how you test it.

The philosophy is the opposite of NestJS: instead of "here's a framework, live inside it," grest-ts says "here's a pattern for how services should be composed and tested, bring your own pieces."

---

## The Kernel (Non-Negotiable, Tightly Coupled)

These 6 pieces form the indivisible core. They cannot be replaced with OSS alternatives because nothing equivalent exists in the ecosystem.

### 1. Contracts (`packages/schema/schema/src/contract/`)
The single source of truth for API behavior. A contract defines input schema, output schema, error cases, and type inference — all in one declaration. The same contract is used by client, server, and tests. This is the identity of the framework.

### 2. Schema (`packages/schema/schema/`)
Runtime validation with AOT compilation. Performance is at typia level. Feeds into contracts for boundary validation. Includes branded types, coercion, refinements, discriminated unions for errors (`ERROR.define()`). Custom-built but the perf advantage is real — same tier as the fastest validators.

### 3. HTTP + WebSocket (`packages/http/`)
Transport binding for contracts. Uses Node.js `http` module + `find-my-way` (same router as Fastify). Contracts bind to routes via `httpSchema()`. Includes RPC codec system for request parsing and response building. Performance is essentially the same as Fastify — both use the same router underneath, grest-ts just does a bit more (e.g., AsyncLocalStorage entry adds ~10% cost).

### 4. Runtime (`packages/runtime/`)
Service bootstrap and lifecycle management. The `compose()` method is **synchronous by design** — all service wiring happens in plain constructor calls, no async DI resolution, no decorators, no magic. This is critical for:
- Deterministic startup order
- Easy debugging (all dependencies visible in one place)
- Test ergonomics (`GGTest.startWorker(AppRuntime)` just works)

Lifecycle: `CREATED → BOOTSTRAPPING → COMPOSING → STARTING → RUNNING → STOPPING → STOPPED`

### 5. Locator (`packages/locator/`)
DI via service keys + AsyncLocalStorage. Think `React.useContext()` for backend — call `MyServiceKey.get()` where you need it, resolution happens through the scope chain. No constructor injection ceremony, no circular dependency headaches. Simpler than tsyringe/awilix, more explicit than NestJS decorators. Includes lifecycle management (start/teardown in priority order).

### 6. Context (`packages/context/`)
Per-request scope propagation via AsyncLocalStorage. Enables hierarchical scoping — root scope per runtime, child scopes per request. Values inherit from parent. This is the mechanism that makes per-request mocking possible.

---

## Testing Architecture (The Killer Feature)

The testing story is what elevates grest-ts from "another framework" to something genuinely novel. It consists of 5 tightly integrated pieces:

### Per-Request Mocking via AsyncLocalStorage
Mocks are scoped to a single request, not global. Parallel tests never conflict. No off-the-shelf test library does this.
```typescript
await ctx.item.add({title: "Test"})
    .with(mockOf(AddressResolverService).resolveAddress.andReturn({lat: 40, lng: -73}))
```

### Sync Compose for Test Setup
Because `compose()` is synchronous, test setup is trivial — just instantiate a runtime. No async DI resolution to await, no container building step.

### Discovery + IPC as Test Orchestration
Each test suite is a **self-contained universe**. When you start multiple runtimes in a test, each gets random ports, and discovery routes them correctly. In parallel test runs, Suite 1's Service A talks to Suite 1's Service B, not Suite 2's copy. Without this:
- You'd need static ports → no parallel tests
- You'd need Docker compose per suite → orders of magnitude slower
- Cross-service integration tests become nearly impossible locally

### Test DB Cloning via Config
`GGTest.with(AppConfig.postgres).clone()` gives each test suite a fresh database copy. Fast (DB-level clone, not Docker spin-up), isolated, automatic cleanup. This is a choice though — you can use other patterns.

### Direct Service Invocation
`callOn(Service).method()` lets you test service internals directly without going through HTTP, enabled by `@testable` decorator.

---

## The Periphery (Already "Bring Your Own")

Everything outside the kernel is optional or pluggable. The framework is already architected this way.

| Piece | Status | Details |
|-------|--------|---------|
| **Logger** (`packages/logger/`) | Inject your strategy | GGLogger enforces structured logging conventions (what to log, from where), but the actual output engine is yours |
| **Metrics** (`packages/metrics/`) | Math built-in, export is yours | Standardized key structure for consistency, but how you export/collect is open |
| **Config** (`packages/config/`) | Optional | Framework core doesn't depend on it. Provides `GGResource`/`GGSecret`/`GGSetting` with `Watchable` pattern for live credential rotation. Multiple stores (file, local, AWS). Useful but not required |
| **DB wrappers** (`packages-libs/db/`) | Thin convenience layers, optional | Just puts config + locator patterns together over mysql2/pg. You don't have to use them |
| **Discovery** (`packages/discovery/`) | Local + static provided, production is yours | Local uses IPC-based router for zero-config dev. Production assumes you write your own adapter (Kubernetes, service mesh, etc.) |
| **Events** (`packages-libs/events/`) | Optional integrations | SNS, SQS, Azure Service Bus, Google Pub/Sub |
| **SQL builder** (`packages-libs/sql/`) | Optional | Type-safe query builder |

---

## Key Architectural Decisions

1. **Contract-first, transport-agnostic**: Same contract binds to HTTP, WebSocket, or internal calls
2. **Integration testing over unit testing**: Contract-level tests survive refactors
3. **Synchronous composition**: All wiring visible in one place, no hidden async DI
4. **Per-request mocking, not global**: AsyncLocalStorage scopes mocks, parallel tests never conflict
5. **Explicit over implicit**: No decorators for wiring, no annotation processing, no reflection
6. **Zero magic**: Plain TypeScript constructors, IDE autocomplete works everywhere

---

## "Could This Be Rebuilt on OSS?" Analysis

### What was considered and rejected:

- **Fastify replacing HTTP layer**: Same router (`find-my-way`), same performance. Would add a dependency and its own lifecycle that conflicts with sync compose. Only benefit is plugins (rate limiting, CORS), which are trivially implemented or cherry-picked.
- **TypeBox/Valibot replacing schema**: Possible but grest-ts schema is typia-level fast. The `ERROR.define()` discriminated union system is tightly coupled to contracts. Maintenance burden is the only argument for switching.
- **Any DI container replacing locator**: Would be heavier and async. Locator is already minimal — a Map with lifecycle hooks + AsyncLocalStorage.

### Conclusion:
The framework already delegates to OSS where it should (mysql2, pg, find-my-way, ws, vitest). The parts that aren't OSS are the parts that **don't exist anywhere else** — the contracts+compose+discovery+testkit kernel. There's nothing to cut that wouldn't break the testing story.

The "rough edges" aren't architectural — they're documentation, discoverability, and making the "this is optional, this isn't" boundary obvious to newcomers.

---

## Mental Model

```
grest-ts = architectural pattern + testing infrastructure
               │
               ├── contracts (how you define APIs)
               ├── schema (how you validate at boundaries)
               ├── http/ws (how contracts bind to transport)
               ├── runtime + compose (how you wire services)
               ├── locator + context (how DI and scoping work)
               │
               ├── testkit (how you test everything)
               │    ├── per-request mocks (AsyncLocalStorage)
               │    ├── test runtime orchestration
               │    ├── discovery as test coordinator
               │    └── DB cloning per suite
               │
               └── bring your own:
                    ├── DB driver (mysql2, pg, whatever)
                    ├── logger engine (pino, winston, whatever)
                    ├── metrics export (prom-client, etc)
                    ├── config source (env, AWS, whatever)
                    └── production discovery (k8s, consul, etc)
```
