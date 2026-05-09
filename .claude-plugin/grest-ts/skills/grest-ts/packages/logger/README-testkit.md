# Logger Testkit

How to test log output using `@grest-ts/testkit`.

## Setup

```typescript
import {GGTest} from "@grest-ts/testkit"
import {MyRuntime} from "../src/main"
import {MyApi} from "../src/api/MyApi.api"

describe("my service", () => {
    const t = GGTest.startWorker(MyRuntime)
    const api = MyApi.createTestClient()

    // Tests here
})
```

## Log Expectations with `.with()`

Assert that a log message occurs during an API call:

```typescript
test("logs on successful action", async () => {
    await api
        .doSomething()
        .with(t.myRuntime.logs.expect("expected message"))
})

test("logs with regex matching", async () => {
    await api
        .createUser({name: "Alice"})
        .with(t.myRuntime.logs.expect(/User created: Alice/))
})

test("logs with object matching", async () => {
    await api
        .processOrder({orderId: "123"})
        .with(t.myRuntime.logs.expect({
            contextName: "OrderService",
            message: "Order processed"
        }))
})
```

## Log Expectations with `.waitFor()`

Wait for async log messages that occur after the call returns:

```typescript
test("async operation logs completion", async () => {
    await api
        .startBackgroundJob({jobId: "job-123"})
        .waitFor(t.myRuntime.logs.expect(/Job completed: job-123/))
})
```

## Using Cursors

For more control, use log cursors to query logs:

```typescript
test("captures multiple logs", async () => {
    // Get cursor at current position
    const cursor = await t.myRuntime.logs.cursor()

    // Perform action
    await api.doSomething()

    // Retrieve logs since cursor
    const logs = await cursor.retrieve()

    // Assert on logs
    expect(logs.some(l => l.message?.includes("Processing"))).toBe(true)
    expect(logs.some(l => l.message?.includes("Completed"))).toBe(true)
})

test("find specific log entry", async () => {
    const cursor = await t.myRuntime.logs.cursor()

    await api.createUser({name: "Bob"})

    const match = await cursor.find("User created")
    expect(match).toBeDefined()
    expect(match?.data?.name).toBe("Bob")
})
```

## Startup Logs

Access logs from runtime startup:

```typescript
test("startup order", async () => {
    const cursor = t.myRuntime.logs.fromStart()
    const logs = await cursor.retrieve()

    const startupLogs = logs.filter(l => l.message?.includes("initialized"))
    expect(startupLogs.length).toBeGreaterThan(0)
})
```

## Log Level Filtering

Filter expectations by log level:

```typescript
import {LogLevel} from "@grest-ts/logger"

test("only error logs", async () => {
    await api
        .triggerError()
        .with(t.myRuntime.logs.expect("Operation failed", LogLevel.ERROR))
})
```

## Multiple Runtimes

When testing with multiple runtimes:

```typescript
const t = GGTest.startWorker(ServiceA, ServiceB)

test("logs in both services", async () => {
    // Expect log in specific runtime
    await api
        .crossServiceCall()
        .with(t.serviceA.logs.expect("Calling ServiceB"))
        .with(t.serviceB.logs.expect("Request received"))
})

test("logs across all runtimes", async () => {
    // Use t.all() for all runtimes
    await api
        .broadcast()
        .with(t.all().logs.expect("Broadcast received"))
})
```

## Matcher Types

| Matcher | Example                        | Description              |
|---------|--------------------------------|--------------------------|
| String  | `"exact message"`              | Exact substring match    |
| RegExp  | `/pattern/`                    | Regular expression match |
| Object  | `{ contextName: "MyService" }` | Object property match    |

### Object Matcher Properties

```typescript
interface LogMatcher {
    contextName?: string    // Service/class name
    message?: string        // Log message (substring)
    level?: LogLevel        // Minimum log level
    data?: object           // Data properties to match
}

// Example
await api
    .doSomething()
    .with(t.myRuntime.logs.expect({
        contextName: "OrderService",
        message: "processed",
        data: {orderId: "123"}
    }))
```
