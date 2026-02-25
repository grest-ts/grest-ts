<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/logger-console

Colored console logger implementation for `@grest-ts/logger`. Formats log entries with ANSI colors, timestamps, log levels, and context — 
designed to be readable when a human needs to read logs from the service console – useful for debugging when developing.

## Quick Start

```typescript
import {GG_LOG} from "@grest-ts/logger"
import {GGLoggerConsole} from "@grest-ts/logger-console"

// In your runtime's compose():
GG_LOG.get().addLogger(
    new GGLoggerConsole({showData: true})
)
```

Output looks like:

```
14:32:45 12345 INFO  MyService  Starting up
14:32:45 12345 ERROR MyService  Connection failed [stack trace...]
```

## Options

```typescript
new GGLoggerConsole({
    minLevel?: LogLevel,              // Filter by minimum level (default: LOG_LEVEL env var, or DEBUG)
    showData?: boolean,               // Include data objects in output (default: true)
    timestampFormat?: 'full' | 'time' // 'time' = HH:MM:SS (default), 'full' = YYYY-MM-DD HH:MM:SS
})
```

The `LOG_LEVEL` environment variable is respected automatically (`DEBUG`, `INFO`, `WARN`, `ERROR`, `CRITICAL`).

## Enriching Logs with `addContext()`

The most useful feature — `addContext()` lets you inject extra information into every log line. The callback receives the `parts` array (the segments that make up each log line) and can push additional values into it. These appear between the source name and the message.

### Real-World Example

```typescript
private getLogger() {
    return new GGLoggerConsole({showData: true})
        .addContext((p) => {
            // Service name
            p.push(GGLocator.getScope().serviceName);

            // Trace ID (short) — for correlating logs across services
            if (GG_TRACE.has()) {
                p.push(GG_TRACE.get().spanId.slice(0, 6));
            }

            // Current HTTP request
            if (GG_HTTP_REQUEST.has()) {
                const req = GG_HTTP_REQUEST.get();
                p.push(req.method + " " + req.path);
            }

            // Authenticated user
            if (UserContext.has()) {
                const user = UserContext.get();
                p.push(user.username + "(" + user.id + ")");
            }

            // Tenant/company (multi-tenant apps)
            if (CompanyContext.has()) {
                p.push("C:" + CompanyContext.get().companyId);
            }
        })
}
```

This produces log lines like:

```
14:32:45 12345 INFO  OrderService realestate a3f2b1 POST /api/orders john(42) C:7  Creating order
```

Every part is context-aware — trace IDs, request info, and user context are only present when available (e.g. outside of an HTTP request, those parts are simply omitted). This makes logs self-describing: you can tell exactly which user, request, and service produced each line.

## Log Output Format

Each log line is composed of these segments:

```
[timestamp] [pid] [level] [contextName] [custom context...] [message] [data] [error]
```

- **timestamp** — gray
- **pid** — process ID
- **level** — color-coded (green=INFO, yellow=WARN, red=ERROR, gray=DEBUG)
- **contextName** — cyan, the `this` or TAG string passed to `GGLog.info(this, ...)`
- **custom context** — added by `addContext()` providers
- **message** — colored by level
- **data** — structured data, auto-sanitized (large buffers, files, deep objects are summarized)
- **error** — stack traces, validation errors, and debug context are formatted with indentation
