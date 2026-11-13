<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# Testkit

## Three tiers

| API | Acts on | For how long |
|---|---|---|
| `GGTest.*` (`startWorker`, `with(cfg)`, `clock`) | the test file and every runtime it starts | the `describe` it is in, or the test when called inside one |
| `t.x.*` (`t.main.config`, `t.main.logs`, `t.main.jobs`) | one runtime (`t.all()` for all of them) | the test (config changes are undone after it) |
| Interceptors (`mockOf(S).m`, `spyOn(S).m`, `Api.mock.m`) and their modifiers (`.times(n)`, `.andReturn(...)`) | the calls made while their action runs | one test action: the `.with(...)` / `.waitFor(...)` it is passed to |

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
        // Config changes are automatically reverted after each test
        await t.myRuntime.config.update(MY_CONFIG_KEY, newValue);

        // t.all() selects all runtimes
        await t.all().config.update(SHARED_KEY, value);

        // t.myRuntime.jobs - from @grest-ts/job/testkit
        // Jobs don't run on their own under GGTest; run one when the test needs it
        await t.myRuntime.jobs.run("expired-sessions").toMatchObject({result: "DONE"});
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

Test calls work only inside the testkit's context. A hook imported from `"vitest"` (`import {afterEach} from "vitest"`)
runs outside it, and a call there throws; use the global hooks or these.

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

When testing error responses, use `.toBeError()` with an error class. After `.toBeError()`, further `.toMatchObject()` calls check the error data, and `.withContext()` checks its context (`displayMessage`, `ref`, …). Spies (`MyApi.spy.x`, `spyOn(S).x`) take the same chain.

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

// The error's context: what the client sees as displayMessage
await alice.user.create({name: "taken"})
    .toBeError(SERVER_ERROR)
    .withContext({displayMessage: expect.stringContaining("Validation Failed")});
```

### Chaining with interceptors

Assertions chain naturally with `.with()` and `.waitFor()`:

- `.with(x)` listens only while the action runs (plus 25 ms), and checks `x` right after.
- `.waitFor(x)` keeps listening after the action until `x` is met or times out (5 s), then stops: a later repeat of
  the same message is unexpected. `x.within(ms)` sets that time where you write the expectation, so a broken test
  fails in what the call should take, not in the default.

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
`mockOf`/`spyOn` intercept calls to internal services: in a runtime the testkit started, and in the test process itself
(see [Instances the test makes](#instances-the-test-makes)).

### mockOf() - replace with fake data

```typescript
import {GGTest, mockOf} from "@grest-ts/testkit";

test('mock external service', async () => {
    await alice.checklist.add({title: "Visit Times Square", address: "123 Main St"})
        .with(mockOf(AddressResolverService).resolveAddress
            .toEqual("123 Main St")              // Validate input
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
            .toEqual("123 Main St")                      // Validate input
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

// One call or more, when the count doesn't matter (a retry, a poll); .waitFor() waits for the first
.with(mockOf(Service).method
    .andReturn(result)
    .atLeastOnce())

// Answer each call from its input; the callback may be async
.with(mockOf(Service).method
    .andReturn(async ({id}) => {
        await competingWrite(id)    // e.g. race the code under test
        return result
    }))

// Mock with delay
.with(mockOf(Service).method
    .andReturn(result)
    .sleep(100))                // Wait 100ms before returning

// Mock throwing an error: the caller gets it typed, with its data
// (its type must be defined in code the runtime loads; an unknown type arrives as SERVER_ERROR)
.with(mockOf(Service).method
    .andReturn(new NOT_AUTHORIZED()))
.with(mockOf(Service).method
    .andReturn(() => { throw new QUOTA_EXCEEDED({left: 0}) }))

// Spy switching to response validation
.with(spyOn(Service).method
    .toMatchObject({id: "a"})           // Validate input
    .response.toMatchObject({out: 1})   // Switch to response, then validate
)

// Spy expecting error response: its context and data
.with(spyOn(Service).method
    .toBeError(QUOTA_EXCEEDED)
    .withContext({displayMessage: "Over quota"})
    .toMatchObject({left: 0})
)
```

### What the input matchers see

`toEqual` / `toMatchObject` and an `andReturn` callback get the method's arguments in one value, typed from its
signature:

| Method | Input |
|---|---|
| `run(input: {id: string})`, `run({id}: {id: string})` | the argument itself: `{id}` |
| `get(id: string)` | the argument itself: `"a"` |
| `pair(id: string, count: number)` | the arguments as a tuple: `["a", 2]` |

`@mockable` intercepts async methods and async function fields (`run = async (…) => …`). `mockOf(S).x` throws for a
sync method or a class without `@mockable`. A method that isn't `async` but returns a Promise is sync to `@mockable`:
its type looks the same as an async one, so `mockOf(S).x` compiles and then throws; declare it `async`. Fields only exist
on instances, so `mockOf` can't check them; a mock of a sync field never gets a call, which the default `times(1)`
reports. Fields are wrapped when an instance is constructed under the testkit (in a runtime or in the test process);
fields declared by a subclass of a `@mockable` class need `@mockable` on that subclass too.

### Instances the test makes

`mockOf`/`spyOn` also reach a `@mockable` instance the test process makes and calls: in a test body, or one a
`GGTest.startInline` runtime made (see the db-dynamodb README, "Testing Code Without an API in Front"). An interceptor
is active while an action runs, or while `GGTest.waitFor` waits for it, so call the code next to a `GGTest.waitFor`:

```typescript
const [, order] = await Promise.all([
    GGTest.waitFor(mockOf(PaymentsApi).charge.toMatchObject({amount: 5}).andReturn({id: "ch_1"})),
    orders.place({sku: "A1", amount: 5}),
])
expect(order.chargeId).toBe("ch_1")
```

`GGTest.waitFor` registers the interceptor before `Promise.all` evaluates the next item, so the call can't come first.

### Schema mock/spy vs @mockable mock/spy

| | Schema mock/spy (`MyApi.mock.method`) | @mockable mock/spy (`mockOf(Service).method`) |
|---|---|---|
| **What it intercepts** | HTTP calls between runtimes | Internal method calls, in a runtime or the test process |
| **Use case** | Mock/spy on service-to-service communication | Mock/spy on external dependencies (3rd party APIs, etc.) |
| **How to use** | `MyApi.mock.method.andReturn(...)` | `mockOf(Service).method.andReturn(...)` |
| **Import** | `import "@grest-ts/http/testkit"` | `import {mockOf, spyOn} from "@grest-ts/testkit"` |

A call that carries a service token from `@grest-ts/oauth` needs nothing extra: while no authorization
server runs in the test, the token is a placeholder, and a schema mock never checks it. See
[Service tokens in tests](../../../packages-libs/auth/oauth/README.md#service-tokens-in-tests).

### Third-party services

Put each third party behind one thin `@mockable` adapter. It's the only class that knows the vendor's HTTP or SDK:
it sends the request, parses the response with a schema and returns only the fields you use.

```typescript
const IsGhToken = IsObject({token: IsString, expires_at: IsString})

@mockable
export class GitHubApi {
    async mintRepoToken(repo: RepoRef): Promise<RepoToken> {
        const res = await this.http.post(`/app/installations/${repo.installationId}/access_tokens`, {repositories: [repo.name]})
        const parsed = IsGhToken.parse(res)          // structure checked at the edge; a bad response is a SERVER_ERROR
        return {token: parsed.token, expiresAt: Date.parse(parsed.expires_at)}
    }
}
```

- **Everything above the adapter** is tested through the contract, with `mockOf(GitHubApi)` returning small,
  domain-shaped answers. That includes the failure decisions (retry, re-auth, telling the user):
  `.andReturn(new SSO_REQUIRED())`.
- **Keep the adapter itself thin** and don't unit-test it. A test against a hand-written response only restates
  the implementation; only a real call proves it. Check it against the real service when you change it.
- **A fake** (a stand-in that holds state and speaks the vendor's protocol) is worth building only for traffic
  that doesn't start in your code: the vendor calling you (webhooks, OAuth redirects), non-Node clients (a `git`
  binary), or a local dev environment without the real service. Build it as an ordinary `GGRuntime`: a custom
  `GGHttpCodec` speaks the vendor's wire format, and an admin contract seeds and resets it.

---

## Controlling time

`GGTest.clock` moves `Date` in the test and in every runtime it started (inline, worker, isolated) at once.
Time keeps flowing from the time you set, unless you stop it.

```typescript
await GGTest.clock.set(new Date("2026-03-01T09:00:00Z"))   // number = epoch ms
await GGTest.clock.advance(30 * 60_000)                    // jump forward, fire due scope timers
await GGTest.clock.stop()                                  // Date.now() and scope timers wait until set/advance/start
await GGTest.clock.start()                                 // flows again from the current fake now
GGTest.clock.now()                                         // same as Date.now() in the test
```

- Set in a test, it's undone after the test. Set in a `describe` or `beforeAll`, it holds for that block. The
  default is real time. A runtime started later in a test starts on the clock's time; runtimes started at describe
  level boot on real time, before a describe-level `set`.
- Clocks outside the app aren't faked: DynamoDB TTL, SQL `NOW()`, Redis `EXPIRE`, S3 `LastModified`. Pass the
  app's time to them instead.
- `Date` and `Temporal.Now` are faked; `Intl`'s implicit "now" (e.g. `Intl.DateTimeFormat().format()` with no
  date) isn't. Pass it a date.
- `set` on a stopped clock moves it and keeps it stopped there.
- Undoing a test's clock is a jump back. Runtimes started at describe level keep what they wrote at the fake time:
  job locks held by scheduled runs, rows, wall-time caches. A test that advances far or starts schedules should
  start its runtimes in the test, or have its own `describe`.
- The clock is shared by the whole file: don't use it in `test.concurrent` tests. It needs a `describe` (the
  test runner lives there).
- Don't fake `Date` with `vi.useFakeTimers` too. `GGTest.clock` throws while it's active; leave `Date` out of
  `toFake`.

### Timers that follow the clock

A timer follows the clock when it is set with `GGLocator.setTimeout` / `GGLocator.setInterval` (a *scope
timer*): the API for business timers that tests must control, such as a session's expiry. It runs its callback in
the caller's scope and is cleared when its runtime stops. Cancel it with the usual `clearTimeout`/`clearInterval`.

```typescript
this.expiry = GGLocator.setTimeout(() => socket.close(), expiresAt - Date.now())
```

`advance(ms)` is a jump, like a machine waking from sleep. When it resolves:

1. Every runtime is on the new time, before any timer fires.
2. Every scope timer pending before the advance and due by the new time has fired **once**. Within a runtime they
   are started in due order and run concurrently, as overdue timers do after a pause; runtimes go one after another
   in start order. An interval fires once, not once per missed period, and continues from the new time. Timers that
   the callbacks set start from the new time; to see N runs, advance N times.
3. The promises the callbacks returned have settled, awaited together. A rejection fails the `advance`, once every
   runtime has fired its timers; so does a promise still pending after `advance(ms, {timeoutMs})` of real time, with
   where its timer was set. The default is the current test's timeout less a margin (30 s outside a test), shared by
   all runtimes. A callback that awaits something the test does after the `advance` deadlocks until then.

It doesn't wait for work a callback started without returning it (use `.waitFor(...)`), and requests in flight
during the advance may see either time. A `set()` to a later time fires timers as `advance` does; a `set()` back
fires nothing. With the clock stopped, scope timers wait for `advance` or `start()`. `GGJobRunner` schedules and the
`withLock` heartbeat are scope timers: `advance` past a lock's TTL loses the lock, as a stalled run would. A
scheduled job run that fails doesn't fail the `advance`: the runner catches and logs it, so check its logs.

Everything else stays on real time: raw `setTimeout`/`setInterval`, `sleep()`, `withTimeout()`, sockets, IPC and
`performance.now()`. When an `advance` moves past a raw timer that app code set (not node_modules or `@grest-ts/*`)
with a delay of 1 s or more, the runtime logs a warning with where it was set, once per place per test file: use
`GGLocator.setTimeout` if it should follow the clock. An `eslint-disable` on the line doesn't silence it.
`GG_TEST_CLOCK_RAW_TIMER_MS` changes that 1 s threshold (`0` checks every raw timer, including `setTimeout(fn)`
with no delay, at the cost of a stack trace each).

Mixed with `vi.useFakeTimers`: a scope timer set while vitest fakes `setTimeout` is a vitest timer, and one set while
vitest fakes `Date` gets its due time in vitest's time. Scope timers set before `vi.useFakeTimers` stay on the clock.

### Clocks the framework doesn't own

Some third-party clocks can't be faked, such as an SDK's clock-skew correction. `GGTestClock.onChange` runs a hook in
each isolate whenever the clock changes, before that isolate acknowledges the change and before any timer fires.
Register it from test-only code, such as your package's `testkit/index-testkit.ts`, which the testkit loads into
every runtime and the test:

```typescript
import {GGTestClock} from "@grest-ts/testkit"

GGTestClock.onChange(({offsetMs, stoppedAt}) => { /* resync the SDK's clients */ })
```

---

## Runtime start and worker reuse

- **Runtimes start in parallel.** All runtimes of a `describe` boot at the same time, so a runtime must not call a peer
  from its `start()`: the peer may not be registered yet, and the call fails as a discovery miss ("Service '…' is not
  registered"). Call peers lazily, when a request needs them. Discovery deliberately doesn't wait for a booting peer:
  production starts runtimes independently too, so a start that needs a peer would only hide the problem in tests.
- **`compose()` must be re-entrant.** Under vitest's `isolate: false` a stopped runtime's worker thread is reused for
  the next start of the same runtime, in a later `describe`, a later file of the same vitest worker, or a test that
  starts it: `compose()` runs again in a module graph that is already loaded. Keep state on the instances `compose()`
  creates; no module-level `.define()`, cache or registry filled from `compose()`.
- Reuse is on when the vitest project runs with `isolate: false` and has
  `globalSetup: ['@grest-ts/testkit-vitest/globalSetup']`, which passes the setting to the test files. Under the
  default `isolate: true` every start boots a fresh worker.

## Usage

Check README-testkit.md files within packages you are interested in. Common ones being:

- [Logger](../../packages/logger/logger/README-testkit.md) - Accessing logs during the test flow.
- [Metrics](../../packages/metrics/README-testkit.md) - Accessing metrics during the test flow.

## Extending framework with custom packages and adding testkit capabilities.

- [Extending Guide](./README-extending.md) - How to create testkit extensions - adding capabilities to the testing framework for custom packages.
