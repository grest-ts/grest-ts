# Framework Philosophy

## Core Identity

This is **not "better tRPC"**. This is a **test-first microservice framework** where the RPC definition is the foundation, but the test harness is the product.

## Key Design Decisions

### 1. Contract-First, Transport-Agnostic

- API contracts are separate artifacts, not tied to server code
- Same contract can bind to HTTP, WebSocket, or internal calls
- Enables multi-repo setups with 100+ engineers where client and server live in separate repositories
- Contract is the shared dependency, not server types

### 2. Integration Testing Over Unit Testing

**Why:** Unit tests break on refactors. Integration tests at the contract level survive them.

Real-world development pattern:
1. Write integration test against API contract
2. Build/refactor implementation freely
3. Tests pass → ship
4. Split a service → just add it to the test runtime, tests keep passing

> "I can literally do a splitting service refactor and my tests keep working"

Unit tests protect implementation. Contract-level integration tests protect behavior.

### 3. Per-Request Mock/Spy at Contract Level

Not global mocks. Not implementation-level mocks. Contract-level, per-request:

```typescript
await alice.checklist.add({...})
    .with(mockBy(AddressResolverService).resolveAddress
        .toEqual({address: "123 Main St"})
        .andReturn({lat: 40.7589, lng: -73.9851})
    )
    .toMatchObject({...});
```

- **mock**: Replace the service response while this test action runs
- **spy**: Call through to real service, assert on input/output
- Works across service boundaries at API level

A mock is bound to the *time* its action runs, not to one request's async context: any
call to that method during the action hits it, including calls from parallel requests.
That is expected — isolating mocks per concurrent request would cost a lot of machinery
for a case tests rarely need. Run actions that mock the same method sequentially.

When you split a service, mocks at contract level keep working. Mocks at implementation level break.

### 4. Multi-Service Test Runtime

```typescript
GGTest.startWorker(ChecklistRuntime, BlockerRuntime);
GGTest.with(ChecklistConfig.resources.postgres).clone();
```

- Start multiple services together
- Clone databases for test isolation
- No docker-compose ceremony
- Choose test level: unit (mock everything), component (mock externals), integration (everything real)

### 5. AsyncContext Over Explicit Context

Instead of threading context through every function:

```typescript
// Explicit (tRPC style) - verbose for deep call stacks
procedure.use(({ ctx, next }) => next({ ctx: { ...ctx, user } }))

// Implicit (AsyncLocalStorage) - get it where you need it
const user = GG_USER_AUTH_TOKEN.get()
```

Trade-off: Less explicit, but cleaner for complex services with 6+ deep call chains. Real services aren't thin controllers.

### 6. Opinionated 99% Case

"Everything is possible" creates verbosity. Optimize for the common case:

```typescript
// 99% case: simple, clean
ChecklistRpc.methods({ list: { output: tArray(tItem) } })

// 1% edge case: verbose is fine
ChecklistHttp.routes({ custom: GGRpc.POST("custom", {...}) })
```

### 7. Type/Validation Library is Commoditized

Zod, Valibot, custom `@grest-ts/type` - doesn't matter. Same interface:

```typescript
schema.parse(input) → validated object | error
```

Custom syntax preferred for DX, but swappable. Building a type library is 1-2 days with AI. Not the differentiator.

## What This Enables

### Refactor-First Development

| Scenario | Unit Tests | Contract-Level Integration |
|----------|------------|---------------------------|
| Split service | All break | Add to runtime, pass |
| Rename internal class | Many break | Pass |
| Change DB schema | Many break | Pass (if behavior same) |
| Extract shared library | Many break | Pass |

### Test Level Selection

Same test, different modes:
- **Call through**: Real services, real DBs
- **Mock**: Replace specific service responses
- **Spy**: Call through + assert on inputs/outputs

## Settled Decisions

Questions that come up repeatedly. These are deliberate; revisit only with a concrete failure.

### Test level: component tests first, unit tests for logic

Default to integration/component tests: boot the runtime(s), call the contract, mock only
the part of the system you want to skip — usually a third party you don't build a full fake
for (`@mockable` around an SDK, `Api.mock.x` for another service). That is less setup than
constructing a class and injecting fakes into it, and it tests several classes together the
way they run. A unit test (one class, deps faked by hand) is for pure logic with many
cases — parsers, validators, calculations — not for wiring.

Consequence: `mockOf` / `spyOn` work only inside a booted runtime. That is the point, not a
gap. When an integration test can't reach a detail cheaply, test that detail as a unit test
of the pure function rather than mocking the world around a class.

### `.times(n)` is exact

`times(n)` fails the test when the mock is called more *or fewer* than `n` times. The default
is 1. `times(0)` asserts the method is never called.

### Unmocked `@mockable` calls go through

A `@mockable` method with no mock registered runs for real. Mocks are opt-in per action, so
the same runtime serves tests that mock a dependency and tests that use it.

### No module mocking in integration tests

Inside a booted runtime, don't `vi.mock` / `jest.mock`. A module mock replaces code by import
path behind the framework's back — it reaches the runtime's workers unpredictably, leaks
across tests and bypasses the contract. Use `@mockable` at the boundary, or a contract mock.
In a plain unit test of one class, module mocking is a normal tool.

### `NODE_ENV=production` selects the real config stores

`GGConfigLocator` uses the local config unless `NODE_ENV === "production"`. A production
deployment must set it; forgetting usually crashes at start (local endpoints don't exist),
which is acceptable. This keeps dev and test zero-config.

### Ambient wire values flow to downstream calls

An ambient wire (`GGHeader`/`GGCookie` never `.define()`d) keeps its inbound value in
context, and any client whose schema uses the same wire sends it on. That propagation is the
purpose of an ambient wire. Verified wires (`.define()`d) hold a credential, which is
cleared before the handler runs, so credentials are not forwarded.

### Locator for infrastructure, explicit wiring for domain

Framework infrastructure (logging, config, discovery, metrics) is ambient via the locator.
Domain services are wired explicitly in `compose()` — constructed there and passed to whoever
needs them. Read a domain locator key in `compose()`, not inside a method.

## Why Not Existing Solutions?

| Solution | Gap |
|----------|-----|
| tRPC | Types tied to server, no contract separation, testing is afterthought |
| OpenAPI | YAML schema, codegen ceremony, no test integration |
| gRPC | Another language (protobuf), heavy for TypeScript-only |
| Jest/Vitest alone | No per-request mocks, no multi-service runtime, manual everything |

## The Honest Trade-off

This approach optimizes for:
- Fast iteration during active development
- Large refactors without test rewrites
- Teams that "don't know exactly what they're building yet"

At the cost of:
- Slower tests than pure unit tests
- Less precise bug localization
- Learning a new framework

## Summary

The value is in the **combination**:
- Contract-first RPC (exists elsewhere)
- Multi-service runtime (exists elsewhere)
- Per-request contract-level mock/spy (novel)
- Database cloning for isolation (exists elsewhere)
- Fluent test assertions on API calls (novel)

Each piece exists. The integrated experience doesn't.
