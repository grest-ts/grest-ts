# @grest-ts/metrics

Type-safe metrics collection library for Grest Framework.

## Features

Type-safe metrics collection library with support for counters, gauges, and histograms.

Provides a structured way to define, collect, and export application metrics with:

- Prometheus-style metrics (Counter, Gauge, Histogram)
- Type-safe labels
- Centralized metric definitions
- Multiple export formats

Type-safe metrics collection library with support for counters, gauges, and histograms.

## Quick usage example

```typescript
// Define metric keys.
// This additionally acts as documentation of metrics provided by the application.
export const AppMetrics = GGMetrics.define('/app/', () => ({
    actions: new GGCounterKey('actions_total', {
        help: 'Total number of actions',
        labelNames: ['type']
    }),
    // ... add more metrics here. All well documented and type safe.
}));

// Usage in the runtime.
AppMetrics.actions.inc(1, {type: "read"}); // labels are typesafe (values are always strings)

```

## Documentation

- [Usage](./README-usage.md) - How to define and collect metrics
- [Testing](./README-testkit.md) - How to test metric changes with testkit
- [Extending](./README-extending.md) - How to add custom exporters
