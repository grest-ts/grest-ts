# @grest-ts/logger

Async context-aware logging library for Grest Framework.

## Features

- Multiple log levels (debug, info, warn, error, critical)
- Async context propagation (per-request logging)
- Pluggable loggers (console, custom)
- Structured data logging

## Quick usage example

```typescript

GGLog.debug(this, "Doing something cool!", {coolSomethingId: something.id})

GGLog.info(this, "Doing something cool!", {coolSomethingId: something.id})

GGLog.warn(this, "Doing something cool!", {coolSomethingId: something.id})

GGLog.error(this, "Something went wrong", {coolSomethingId: something.id})

const error = new Error("Something went wrong!")
GGLog.error(this, error)
GGLog.error(this, "User registration flow failed!", error)

// All levels provide multiple ways to log messages:
GGLog[LEVEL](this, "Doing something cool!", {coolSomethingId: something.id})
GGLog[LEVEL](this, new Error("some error"))
GGLog[LEVEL](this, "My flow failed", new Error("some error"))
```

## Documentation

- [Usage](./README-usage.md) - How to use logging in your application.
- [Testing](./README-testkit.md) - How to test log output with testkit.
- [Extending](./README-extending.md) - How to add custom loggers.
