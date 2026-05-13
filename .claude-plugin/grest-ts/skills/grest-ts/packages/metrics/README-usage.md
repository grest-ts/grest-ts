# Using @grest-ts/metrics

## Quick Start

### 1. Define Metrics

```typescript
import {GGMetrics, GGCounterKey, GGGaugeKey, GGHistogramKey, GGLazyGaugeKey} from "@grest-ts/metrics";

export const AppMetrics = GGMetrics.define('/app/', () => ({

    // Counter - only increments
    requests: new GGCounterKey('requests_total', {
        help: 'Total HTTP requests'
    }),

    // Counter with labels
    errors: new GGCounterKey<{ code: string }>('errors_total', {
        help: 'Total errors by code',
        labelNames: ['code']
    }),

    // Gauge - can go up or down
    activeConnections: new GGGaugeKey('active_connections', {
        help: 'Current active connections'
    }),

    // Lazy Gauge - computed on read
    memoryUsed: new GGLazyGaugeKey('memory_bytes', {
        help: 'Current memory usage',
        getValue: () => process.memoryUsage().heapUsed
    }),

    // Histogram - tracks distributions
    responseTimes: new GGHistogramKey('response_time_ms', {
        help: 'Response time distribution',
        buckets: [10, 50, 100, 500, 1000]
    })
}));
```

### 2. Initialize the Metrics Loader

```typescript
import {createMetricsLoader} from "@grest-ts/metrics";

// In your runtime
createMetricsLoader();
```

### 3. Use Metrics

```typescript
// Counter
AppMetrics.requests.inc();
AppMetrics.errors.inc({code: '500'}, 1);

// Gauge
AppMetrics.activeConnections.inc();
AppMetrics.activeConnections.dec();
AppMetrics.activeConnections.set(42);

// Histogram
AppMetrics.responseTimes.observe(150);

// Timer helper
const done = AppMetrics.responseTimes.startTimer();
// ... do work ...
done(); // records elapsed time
```

## Metric Types

| Type          | Methods                          | Use Case                                             |
|---------------|----------------------------------|------------------------------------------------------|
| **Counter**   | `inc(value?)`                    | Monotonically increasing values (requests, errors)   |
| **Gauge**     | `set(value)`, `inc()`, `dec()`   | Values that go up and down (connections, queue size) |
| **LazyGauge** | `getValue()`                     | Computed on read (memory, CPU)                       |
| **Histogram** | `observe(value)`, `startTimer()` | Distributions (latencies, sizes)                     |

## Exporting Metrics

```typescript
import {GGJsonMetricsExporter} from "@grest-ts/metrics";

const output = new GGJsonMetricsExporter().getMetrics();
// Returns { timestamp, metrics: { ... } }
```

Exporters support include/exclude filtering:

```typescript
import {GGJsonMetricsExporter} from "@grest-ts/metrics"
import {AppMetrics, InternalMetrics} from "./metrics"

// Include only specific metrics
const publicExporter = new GGJsonMetricsExporter({
    include: [AppMetrics]
});

// Exclude internal metrics
const filteredExporter = new GGJsonMetricsExporter({
    exclude: [InternalMetrics]
});
```

## Labels

Labels add dimensions to metrics:

```typescript
const httpRequests = new GGCounterKey<{ method: string; status: number }>('http_requests', {
    help: 'HTTP requests',
    labelNames: ['method', 'status']
});

// Usage
httpRequests.inc({method: 'GET', status: 200}, 1);
httpRequests.inc({method: 'POST', status: 500}, 1);
```


### Expectation Methods

| Method                        | Description                                            |
|-------------------------------|--------------------------------------------------------|
| `.inc(labels, delta?)`        | Expect counter to increment by exact delta (default 1) |
| `.incAtLeast(labels, delta?)` | Expect counter to increment by at least delta          |
| `.dec(labels, delta?)`        | Expect gauge to decrement by exact delta               |
| `.observation(labels)`        | Expect histogram to record an observation              |
| `.noChange()`                 | Expect no changes to this metric                       |
| `.noChangeFor(labels)`        | Expect no changes for specific labels                  |
