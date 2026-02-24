# Testkit

## Overview

The testkit provides comprehensive testing capabilities to the framework, mostly focusing on backend integration & component level testing.

### Main features:

* Runs on top of vitest - all normal vitest features are available!
* Component & integration testing
    * Parallel execution of tests.
    * Test a single or multiple components.
    * Mock or spy communication between runtimes.
    * Mock external dependencies (like third party API-s) using @mockable decorator.
    * Manage databases (clone, seed, etc...).
* Unit testing
    * Standard vitest and its capabilities. Nothing too special here.

Overall idea is that you get to run your services as if they were running in production, but get access to where you need - like:

* accessing logs
* accessing metrics
* accessing & updating config
* mock or spy on API calls / external requests / events etc...
* easy setup for isolated databases.

To fully understand the fun, you have to try it out on how easy and fast testing microservice environments can become.
Start from a single service and easily scale up to multi service environments with ease.
This is a capability easy to underestimate when starting a project, but you absolutely love it when things start scaling up!

## Capabilities example

```typescript
import {GGTest} from "@grest-ts/testkit";
import {MyRuntime} from "./MyRuntime";
import {MyApi} from "./MyApi.api";

describe("my test", () => {
    const t = GGTest.startInline(MyRuntime);
    const client = MyApi.createTestClient();

    test("selector extensions", async () => {
        // t.myRuntime.logs - from @grest-ts/logger/testkit
        const cursor = await t.myRuntime.logs.cursor();
        await client.doSomething();
        const logs = await cursor.retrieve();

        // t.myRuntime.config - from @grest-ts/config/testkit
        await t.myRuntime.config.update(MY_CONFIG_KEY, newValue);

        // t.all() selects all runtimes
        await t.all().config.update(SHARED_KEY, value);
    });

    test("schema extensions - mock/spy", async () => {
        // MyApi.mock.methodName - from @grest-ts/http/testkit
        await client.getUser({id: 1})
            .with(MyApi.mock.getUser.andReturn({name: "Alice"}));

        // MyApi.spy.methodName - passthrough with validation
        await client.createUser({name: "Bob"})
            .with(MyApi.spy.createUser.toMatchObject({name: "Bob"}));
    });

    test("log expectations with .with()", async () => {
        await client.doSomething()
            .with(t.myRuntime.logs.expect("expected message"));
    });

    test("waitFor - wait for async side effects", async () => {
        await client.triggerAsyncProcess()
            .waitFor(t.myRuntime.logs.expect("process completed"));
    });
});
```

---

## GGTestContext

`GGTestContext` is the recommended way to make API calls in tests. It extends `GGContext` and provides lifecycle hooks, API registration, and context management (e.g. auth headers).

### Basic usage

```typescript
import {GGTest, GGTestContext} from "@grest-ts/testkit";
import {MyRuntime} from "../src/main";
import {UserApi} from "../src/api/UserApi.api";
import {ChecklistApi} from "../src/api/ChecklistApi.api";

describe("my tests", () => {
    GGTest.startWorker(MyRuntime);

    const alice = new GGTestContext("Alice")
        .apis({
            user: UserApi,
            checklist: ChecklistApi
        })
        .beforeAll(async () => {
            const result = await alice.user.register({
                username: "alice", email: "alice@example.com", password: "secret123"
            });
            alice.set(AUTH_TOKEN, result.token);
        });

    test('list items', async () => {
        await alice.checklist.list().toMatchObject([]);
    });
});
```

### `.apis()`

Registers APIs and returns `this` merged with test clients for all registered items.
After calling `.apis()`, you can access each API directly as a property.

```typescript
const admin = new GGTestContext("Admin")
    .apis({
        building: BuildingApi,
        apartment: ApartmentApi,
        client: ClientApi
    });

// Now call API methods directly:
await admin.building.sync({...});
await admin.apartment.list({...});
```

### `.callOn()`

Call methods on APIs or services not registered via `.apis()`.

```typescript
// Call an API you didn't register upfront
await alice.callOn(UserPublicApi).login({username: "alice", password: "secret123"});
```

### Lifecycle hooks

```typescript
const alice = new GGTestContext("Alice")
    .apis({user: UserApi})
    .resetAfterEach()                           // Reset context state (headers etc) after each test
    .beforeAll(async () => { /* once */ })       // Runs once before all tests
    .beforeEach(async () => { /* each */ })      // Runs before each test
    .afterEach(async () => { /* each */ })       // Runs after each test
    .afterAll(async () => { /* cleanup */ });    // Runs once after all tests
```

### Context state management

`GGTestContext` extends `GGContext`, so you can set/get/delete context values (typically auth headers):

```typescript
alice.set(AUTH_TOKEN, token);       // Set a context value (sent as header)
alice.get(AUTH_TOKEN);              // Read a context value
alice.delete(AUTH_TOKEN);           // Remove a context value
```

### Extending GGTestContext

For domain-specific helpers, extend `GGTestContext`:

```typescript
import {GGTestContext} from "@grest-ts/testkit";

export class MyUserContext extends GGTestContext {

    public user: User;

    public async login(data: {username: string, password: string}) {
        const result = await this.callOn(UserPublicApi).login(data);
        this.set(AUTH_TOKEN, result.token);
        this.user = result.user;
    }

    public async loginAndSetup() {
        await this.login({username: "admin", password: "admin"});
    }
}

// Usage in tests:
const admin = new MyUserContext("Admin")
    .apis({checklist: ChecklistApi})
    .beforeAll(async () => {
        await admin.loginAndSetup();
    });
```

---

## Response assertions

All API calls through `GGTestContext` return a `GGTestAction` - a PromiseLike with chainable assertion methods. Assertions are checked when the action is awaited.

### Data assertions

```typescript
// Exact match
await alice.user.get({id}).toEqual({id, username: "alice", email: "alice@example.com"});

// Partial match (like Jest toMatchObject)
await alice.user.get({id}).toMatchObject({username: "alice"});

// Undefined (for void endpoints)
await alice.user.delete({id}).toBeUndefined();

// Array length
await alice.checklist.list().toHaveLength(3);

// Array containment
await alice.checklist.list()
    .arrayToContain({title: "Buy groceries"});
```

### Error assertions

When testing error responses, use `.toBeError()` with an error class. After `.toBeError()`, further `.toMatchObject()` calls check the error data.

```typescript
import {NOT_AUTHORIZED, VALIDATION_ERROR, NOT_FOUND, FORBIDDEN, EXISTS} from "@grest-ts/schema";

// Authorization errors
await john.building.sync({...}).toBeError(NOT_AUTHORIZED);

// Validation errors - check individual field errors
await alice.user.register({username: "ab", password: "", email: "invalid"})
    .toBeError(VALIDATION_ERROR)
    .toMatchObject({
        username: {__issue: {message: "Value must be between 3 and 10 characters"}},
        email: {__issue: {message: "Invalid email format"}},
    });

// Not found
await alice.user.get({id: 999}).toBeError(NOT_FOUND);

// Custom error types
await alice.user.login({username: "alice", password: "wrong"})
    .toBeError(InvalidCredentialsError);
```

### Chaining with interceptors

Assertions chain naturally with `.with()` and `.waitFor()`:

```typescript
await alice.user.login(loginData)
    .with(BlockerApi.spy.checkBlock.toMatchObject({username: "alice"}))
    .toMatchObject({user: {username: "alice"}, token: expect.any(String)});
```

---

## Database cloning

The testkit provides database cloning for test isolation. Each test suite gets its own database clone, ensuring parallel test execution without conflicts.

### MySQL

```typescript
import {GGTest} from "@grest-ts/testkit";
import {MyConfig} from "../src/MyConfig";
import {mysqlLocal} from "../config/local";

describe("my tests", () => {
    GGTest.startWorker(MyRuntime);

    // Basic clone with explicit source config
    GGTest.with(MyConfig.mysql).clone({from: mysqlLocal});

    // With seed files
    GGTest.with(MyConfig.mysql).clone({
        from: mysqlLocal,
        seedFiles: ["./test/seed/admin-users.sql"]
    });

    // Shared clone across parallel workers (same DB for all workers in this group)
    GGTest.with(MyConfig.mysql).clone({
        from: mysqlLocal,
        group: "shared",
        seedFiles: ["./test/seed/admin-users.sql"]
    });
});
```

### PostgreSQL

```typescript
// Same API, just with postgres config
GGTest.with(MyConfig.postgres).clone({from: postgresLocal});
GGTest.with(MyConfig.postgres).clone({from: postgresLocal, group: "shared"});
```

### Shorthand forms

```typescript
// If GGResource has a default value, no `from` needed:
GGTest.with(MyConfig.mysql).clone();

// Seed files as string or array:
GGTest.with(MyConfig.mysql).clone("seed.sql");
GGTest.with(MyConfig.mysql).clone(["seed1.sql", "seed2.sql"]);
```

### Clone options

| Option | Type | Description |
|--------|------|-------------|
| `from` | `{host, user}` | Source database config and credentials. Required when GGResource has no default value. |
| `seedFiles` | `string[]` | SQL files to run after cloning the schema. |
| `group` | `string` | Group name for shared DB cloning across workers. Tests with the same group share one clone. |

### How it works

1. The source database schema is cloned into a unique test schema (named `{db}_{runId}_{groupId}`).
2. If the source database doesn't exist and a `schemaFile` is configured, it is created automatically.
3. Seed files are executed after cloning.
4. The cloned schema is automatically cleaned up after tests complete.
5. When `group` is specified, multiple test suites share the same clone via reference counting.

---

## Mocking & spying on @mockable services

Services decorated with `@mockable` can be mocked or spied on in tests using `mockOf()` and `spyOn()`.

This is different from schema-level mock/spy (like `MyApi.mock.method`) which intercepts HTTP calls between runtimes.
`mockOf`/`spyOn` intercept calls to internal services within a runtime.

### mockOf() - replace with fake data

```typescript
import {GGTest, mockOf} from "@grest-ts/testkit";

test('mock external service', async () => {
    await alice.checklist.add({title: "Visit Times Square", address: "123 Main St"})
        .with(mockOf(AddressResolverService).resolveAddress
            .toEqual({address: "123 Main St"})              // Validate input
            .andReturn({lat: 40.7589, lng: -73.9851})       // Return fake data
        )
        .toMatchObject({
            title: "Visit Times Square",
            lat: 40.7589,
            lng: -73.9851
        });
});
```

### spyOn() - call through and validate

```typescript
import {GGTest, spyOn} from "@grest-ts/testkit";

test('spy on external service', async () => {
    await alice.checklist.add({title: "Visit Times Square", address: "123 Main St"})
        .with(spyOn(AddressResolverService).resolveAddress
            .toEqual({address: "123 Main St"})                      // Validate input
            .responseToMatchObject({lat: 40.7128, lng: -74.0060})   // Validate real response
        );
});
```

### Mock/spy options

```typescript
// Mock with expected call count
.with(mockOf(Service).method
    .andReturn(result)
    .times(2))                  // Expect exactly 2 calls

// Mock with delay
.with(mockOf(Service).method
    .andReturn(result)
    .sleep(100))                // Wait 100ms before returning

// Mock returning an error
.with(mockOf(Service).method
    .andReturn(new NOT_AUTHORIZED()))

// Spy switching to response validation
.with(spyOn(Service).method
    .toMatchObject({input: "data"})     // Validate input
    .response.toMatchObject({out: 1})   // Switch to response, then validate
)

// Spy expecting error response
.with(spyOn(Service).method
    .toBeError(NOT_FOUND)
)
```

### Schema mock/spy vs @mockable mock/spy

| | Schema mock/spy (`MyApi.mock.method`) | @mockable mock/spy (`mockOf(Service).method`) |
|---|---|---|
| **What it intercepts** | HTTP calls between runtimes | Internal method calls within a runtime |
| **Use case** | Mock/spy on service-to-service communication | Mock/spy on external dependencies (3rd party APIs, etc.) |
| **How to use** | `MyApi.mock.method.andReturn(...)` | `mockOf(Service).method.andReturn(...)` |
| **Import** | `import "@grest-ts/http/testkit"` | `import {mockOf, spyOn} from "@grest-ts/testkit"` |

---

## Usage

Check README-testkit.md files within packages you are interested in. Common ones being:

- [Logger](../../packages/logger/logger/README-testkit.md) - Accessing logs during the test flow.
- [Metrics](../../packages/metrics/README-testkit.md) - Accessing metrics during the test flow.

## Extending framework with custom packages and adding testkit capabilities.

- [Extending Guide](./README-extending.md) - How to create testkit extensions - adding capabilities to the testing framework for custom packages.
