# Logger Usage

How to use `@grest-ts/logger` in your application.

## Main features

* While API of the log is simplistic, it stores additional metadata, context etc about where the log happened to help pinpoint the source when analyzing logs at scale and microservices environment.
* Don't forget, at scale logs are not free! Log what you need, don't just "log whatever I want".

## Basic Logging

```typescript
import {GGLog} from "@grest-ts/logger"

export class MyService {
    async doSomething(request: Request): Promise<Response> {
        GGLog.debug(this, "Processing request", {requestId: request.id})

        try {
            const result = await this.process(request)
            GGLog.info(this, "Request processed", {resultId: result.id})
            return result
        } catch (error) {
            GGLog.error(this, "Failed to process", error)
            throw error
        }
    }
}
```

## Log Levels

| Level    | Method             | Use Case                             |
|----------|--------------------|--------------------------------------|
| DEBUG    | `GGLog.debug()`    | Detailed debugging info, high volume |
| INFO     | `GGLog.info()`     | Normal operations, business events   |
| WARN     | `GGLog.warn()`     | Recoverable issues, degraded state   |
| ERROR    | `GGLog.error()`    | Failures requiring attention         |
| CRITICAL | `GGLog.critical()` | System-level failures                |

## Method Signatures

All log methods accept flexible arguments:

```typescript
// Message only
GGLog.info(this, "User logged in")

// Message with data
GGLog.info(this, "User logged in", {userId, ip})

// Error only
GGLog.error(this, error)

// Message with error
GGLog.error(this, "Operation failed", error)

// Message, error, and data
GGLog.error(this, "Operation failed", error, {context: "checkout"})
```

## Context Parameter

The first parameter (`this` or a string) identifies where the log originated:

```typescript
class UserService {
    login() {
        // Logs show "UserService" as context
        GGLog.info(this, "Login attempt")
    }
}

// Or use string context
GGLog.info("Startup", "Application initialized")
```

## Structured Data

Pass structured data as the last parameter:

```typescript
GGLog.info(this, "Order created", {
    orderId: order.id,
    userId: user.id,
    total: order.total,
    items: order.items.length
})
```

## Initialization

Logger is initialized automatically by `GGRuntime`. For manual setup:

```typescript
import {GGLog, LogLevel} from "@grest-ts/logger"
import {GGLoggerConsole} from "@grest-ts/logger-console"

// Initialize
GGLog.init()

// Add console logger
GGLog.add(new GGLoggerConsole({
    minLevel: LogLevel.DEBUG,
    showData: true
}))
```

## Best Practices

### Use static and meaningful messages

```typescript
// Good
GGLog.info(this, "Order payment processed", {orderId, amount})

// Avoid dynamic messages. At scale, these make it hard to filter for specific events.
GGLog.info(this, "Expected " + value + " to be " + somethingElse, {id: orderId})

// Avoid too generic messages, these are harder to filter later.
GGLog.info(this, "Done", {id: orderId})

```

### Include Relevant Context

```typescript
// Good
GGLog.error(this, "Email send failed", {
    userId,
    email: user.email,
    templateId: "welcome",
    error: error.message
})

// Avoid
GGLog.error(this, "Email failed")
```

### Don't Log Sensitive Data

```typescript
// Good
GGLog.info(this, "User authenticated", {userId, method: "password"})

// Avoid
GGLog.info(this, "Login", {username, password, token})
```

### Use Appropriate Levels

```typescript
// Debug - development details
GGLog.debug(this, "Cache lookup", {key, hit: false})

// Info - business events
GGLog.info(this, "User registered", {userId})

// Warn - recoverable issues
GGLog.warn(this, "Rate limit approaching", {userId, remaining: 5})

// Error - failures
GGLog.error(this, "Database connection failed", error)
```
