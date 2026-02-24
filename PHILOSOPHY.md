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

- **mock**: Replace service response for this request only
- **spy**: Call through to real service, assert on input/output
- Works across service boundaries at API level

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
