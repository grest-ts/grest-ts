# Ideas for Testkit Enhancements

## 1. Time Manipulation

Testing time-dependent behavior is universally painful.

```typescript
// Hypothetical API
await f.chain.time.freeze();
await callOn(CacheService).set("key", "value", {ttl: 60000});
await f.chain.time.advance(61000);
await callOn(CacheService).get("key").toBeUndefined(); // Expired

// Or with the .with() pattern
await callOn(SchedulerService).scheduleJob(...)
    .with(f.chain.time.advanceBy(5000))
    .toMatchObject({executed: true});
```

Currently testing TTLs, retries, debouncing, scheduled jobs requires real waits or awkward mocking.

---

## 2. Fault Injection

Testing resilience without actual failures.

```typescript
// What happens when WeatherService is slow?
await callOn(TravelPlanner).plan("NYC")
    .with(WeatherService.fault.latency(3000))
    .toMatchObject({usedCachedWeather: true});

// What happens when it fails?
await callOn(TravelPlanner).plan("NYC")
    .with(WeatherService.fault.error(503))
    .toMatchObject({fallback: true});

// Network partition simulation
await f.weather.fault.disconnect();

// Intermittent failures
await callOn(TravelPlanner).plan("NYC")
    .with(WeatherService.fault.failNth(2)) // Fail every 2nd call
    .toMatchObject({retried: true});
```

This would let teams test circuit breakers, fallbacks, retry logic elegantly.

---

## 3. Call Graph / Trace Visualization

Understanding what actually happened during a test.

```typescript
const trace = await callOn(OrderService).createOrder({...})
    .withTracing();

trace.print();
// OrderService.createOrder
//   → InventoryService.reserve (2ms)
//   → PaymentService.charge (15ms)
//     → FraudService.check (3ms)
//   → NotificationService.send (async, 1ms)

expect(trace.calls).toHaveLength(4);
expect(trace.duration).toBeLessThan(50);
expect(trace.find("PaymentService.charge")).toBeDefined();
```

Currently when a test fails across services, understanding the flow requires digging through logs.

---

## 4. Async Event Assertions

For event-driven architectures.

```typescript
// Assert event was published
await callOn(OrderService).createOrder({...})
    .with(f.events.expect("order.created").toMatchObject({orderId: expect.any(String)}));

// Test event consumer
await f.events.emit("payment.completed", {orderId: "123"});
await f.chain.callOn(OrderService).getOrder("123")
    .toMatchObject({status: "paid"});

// Assert multiple events in order
await callOn(OrderService).createOrder({...})
    .with(f.events.expectSequence([
        {type: "order.created"},
        {type: "inventory.reserved"},
        {type: "payment.initiated"}
    ]));
```

---

## 5. Request Recording & Replay

For debugging production issues or creating regression tests.

```typescript
// Record mode - captures all cross-service calls
const recording = await f.chain.record();
await callOn(OrderService).createOrder({...});
recording.save("./fixtures/order-flow.json");

// Replay mode - uses recorded responses, no actual services needed
await callOn(OrderService).createOrder({...})
    .with(replay("./fixtures/order-flow.json"))
    .toMatchObject({...});

// Useful for: "Customer reported a bug, let me capture their flow and write a test"
```

---

## 6. Contract Evolution / Breaking Change Detection

When someone changes a contract.

```typescript
// In CI, compare against baseline
const changes = await GGContract.diff(OrderApiContract, {baseline: "main"});
// changes = [{method: "getOrder", field: "status", was: "string", now: "enum"}]

// Or as a test assertion
await expect(OrderApiContract).toBeBackwardsCompatibleWith("main");

// Detect breaking vs non-breaking changes
const report = await GGContract.analyze(OrderApiContract);
// report.breaking = ["removed field 'legacyId'"]
// report.nonBreaking = ["added optional field 'metadata'"]
```

Catches: "You added a required field - that breaks existing consumers"

---

## 7. Deterministic Async Ordering

For testing race conditions without flakiness.

```typescript
// Control execution order explicitly
await f.chain.scheduler.pause();

const p1 = callOn(ServiceA).doThing();
const p2 = callOn(ServiceB).doOtherThing();

await f.chain.scheduler.runNext(); // ServiceA runs first
await f.chain.scheduler.runNext(); // ServiceB runs second

// Or test both orderings
await f.chain.scheduler.runInOrder([p2, p1]); // B first, then A

// Test race condition explicitly
await f.chain.scheduler.runConcurrently([p1, p2]); // True parallel
```

---

## 8. Cross-Service Coverage

"What code did this test actually exercise?"

```typescript
const coverage = await callOn(OrderService).createOrder({...})
    .withCoverage();

coverage.print();
// OrderService:      85% (src/orders/create.ts: lines 10-50)
// InventoryService:  40% (src/inventory/reserve.ts: lines 5-20)
// PaymentService:    15% (src/payments/charge.ts: lines 100-110)

// Use in CI to ensure critical paths are tested
expect(coverage.for("PaymentService")).toBeGreaterThan(80);
```

---

## 9. Test Scenarios / Given-When-Then DSL

Higher-level test organization for complex flows.

```typescript
scenario("User places order with insufficient inventory")
    .given(f.chain.callOn(InventoryService).setStock("SKU-123", 0))
    .given(alice.set(GG_USER_AUTH, {userId: 1, role: "customer"}))
    .when(alice.callOn(OrderService).createOrder({sku: "SKU-123", qty: 5}))
    .then(expectError({code: "INSUFFICIENT_INVENTORY"}))
    .then(f.events.expect("order.failed"))
    .then(f.chain.logs.expect("Inventory check failed"));
```

---

## 10. State Snapshots / Checkpoints

Save and restore state during complex test flows.

```typescript
// Set up complex state
await setupUserWithOrders(alice);
const checkpoint = await f.snapshot();

// Test scenario A
await callOn(OrderService).cancelAllOrders(alice.userId);
expect(...);

// Restore and test scenario B
await checkpoint.restore();
await callOn(OrderService).refundOrder(alice.orders[0].id);
expect(...);
```

---

## 11. Automatic Test Data Cleanup

Ensure tests don't leak state.

```typescript
// Automatic cleanup after each test
const user = await f.chain.callOn(UserService)
    .create({name: "Test User"})
    .autoCleanup(); // Deleted after test

// Or scoped cleanup
await f.withCleanup(async () => {
    const order = await callOn(OrderService).create({...});
    // ... test logic ...
}); // order automatically cleaned up
```

---

## 12. Performance Baseline Assertions

Detect performance regressions.

```typescript
await callOn(SearchService).search({query: "test"})
    .toCompleteWithin(100) // ms
    .toMatchObject({results: expect.any(Array)});

// Or against recorded baseline
await callOn(SearchService).search({query: "test"})
    .toNotRegress({baseline: "./perf/search-baseline.json", tolerance: 0.1});
```

---

## 13 - Flaky Test Detection

Automatically retry and report flaky tests

```typescript
GGTest.configure({
    flakyDetection: {
        retries: 3,
        reportThreshold: 0.1, // If fails >10% of runs, flag as flaky                                                                                                      
    }
}); 
```
