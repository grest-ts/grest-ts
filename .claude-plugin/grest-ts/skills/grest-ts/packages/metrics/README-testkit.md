# Metrics Testkit

How to test metric changes using `@grest-ts/testkit`.

## Testing

Use `.with()` to assert metric changes during API calls:

```typescript
import {GGTest} from "@grest-ts/testkit";
import {MainRuntime} from "../src/main";
import {MyApi} from "../src/api/MyApi.api";
import {AppMetrics} from "../src/AppMetrics";

describe("metrics", () => {

    const t = GGTest.startWorker(MainRuntime);
    const api = MyApi.createTestClient();

    test("counter increments with exact delta", async () => {
        await api
            .doSomething()
            .with(t.main.metrics.expect(AppMetrics.requests).inc({}, 1));
    });

    test("counter increments with labels", async () => {
        await api
            .createError()
            .with(t.main.metrics.expect(AppMetrics.errors).inc({code: '500'}));
    });

    test("counter increments at least N times", async () => {
        await api
            .processItems()
            .with(t.main.metrics.expect(AppMetrics.processed).incAtLeast({status: 'OK'}, 1));
    });

    test("metric does not change", async () => {
        await api
            .readOnly()
            .with(t.main.metrics.expect(AppMetrics.writes).noChange());
    });
});
```

## Multiple Runtimes

```typescript
const t = GGTest.startWorker(ServiceA, ServiceB)

test("metrics in specific runtime", async () => {
    await api
        .crossServiceCall()
        .with(t.serviceA.metrics.expect(ServiceAMetrics.outgoingCalls).inc({}))
        .with(t.serviceB.metrics.expect(ServiceBMetrics.incomingCalls).inc({}))
})

test("metrics across all runtimes", async () => {
    await api
        .broadcast()
        .with(t.all().metrics.expect(SharedMetrics.messagesReceived).incAtLeast({}, 2))
})
```
