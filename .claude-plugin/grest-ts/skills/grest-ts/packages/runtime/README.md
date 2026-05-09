<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/runtime

Base class for bootstrapping and managing the lifecycle of a grest-ts service. Handles startup, service composition, graceful shutdown, and signal handling.

## Core Concept

You extend `GGRuntime` and implement the `compose()` method to register your services. The runtime takes care of the rest — starting services in order, wiring up logging/tracing/discovery, and tearing everything down gracefully on shutdown.

## Quick Start

```typescript
import {GGRuntime} from "@grest-ts/runtime"

class MyRuntime extends GGRuntime {

    public static readonly NAME = "my-service"

    compose() {
        // Register your services here.
        // Everything registered via the locator scope during compose()
        // gets lifecycle-managed automatically.
        new MyHttpServer()
        new MyDatabaseClient()
    }
}

// When this file is run directly, starts the runtime.
MyRuntime.cli(import.meta.url)
```

## Lifecycle

The runtime goes through these states in order:

```
CREATED → BOOTSTRAPPING → COMPOSING → STARTING → RUNNING → STOPPING → STOPPED
```

1. **Bootstrapping** — Initializes the locator scope, logging, and tracing
2. **Composing** — Calls your `compose()` method where you register services
3. **Starting** — Calls `start()` on all registered services (by priority)
4. **Running** — Service is live
5. **Stopping** — On `SIGTERM`/`SIGINT`, tears down services in reverse order with a configurable timeout (default 10s)

If any service fails to start, already-started services are cleaned up automatically.

## Compose and Service Registration

`compose()` is synchronous — you should not do any async loading (connecting to databases, fetching config, etc.) directly in it. Instead, register services via `setWithLifecycle` and put async work into the lifecycle's `start()` callback. The runtime will call `start()` on all registered services after compose finishes, ordered by `GGLocatorServiceType` priority.

```typescript
import {GGLocator, GGLocatorKey, GGLocatorServiceType} from "@grest-ts/locator"

const MY_SERVICE = new GGLocatorKey<MyService>("MyService")

class MyService {

    constructor() {
        // Register in the locator with lifecycle callbacks.
        // No async work here — just wire things up.
        GGLocator.getScope().setWithLifecycle(MY_SERVICE, this, {
            type: GGLocatorServiceType.DATABASE,
            start: () => this.connect(),       // async work goes here
            teardown: () => this.disconnect()   // cleanup on shutdown
        })
    }

    private async connect() { /* open connections, load resources, etc. */ }
    private async disconnect() { /* close connections */ }
}
```

Services of the same priority type start concurrently. Different priority levels start sequentially (CONFIG first, then DATABASE, HTTP, and so on). Teardown runs in reverse order.

## `cli()` Entry Point

The static `cli()` method lets your runtime file work as both an importable module and a standalone entry point:

```typescript
MyRuntime.cli(import.meta.url)
```

When the file is run directly (e.g. `node my-runtime.ts`), it starts the runtime. When imported by tests or other runtimes, it does nothing.

## Runtime Metrics

The package also exports `GGRuntimeMetrics` for process-level monitoring — memory usage (heap, RSS, external, array buffers), active handles/requests, and process start time. These are lazy gauges that compute values on read.
