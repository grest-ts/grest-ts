<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# Context Package (@grest-ts/context)

Request-scoped context storage using AsyncLocalStorage. Use this for short-lived data that exists during a single request, job, or message processing - such as tracing IDs, auth data, or request
metadata.

## When do you need it?

- **Framework level**: The framework uses GGContext to propagate request data like trace IDs, authentication, and request metadata through the call stack.
- **Your code**: Use it when you need to access request-specific data without passing it through every function.

Note: GGContext is for **request-scoped data** (short-lived). For long-lived services, use `GGLocator` instead.

## Basic usage example: Auth Context Through Services

```typescript
// Define auth context key
const AuthUserKey = new GGContextKey("authUser", IsObject({id: IsString, role: IsString}))

// ServiceA - called by HTTP handler, auth is already set in context
class ServiceA {
    async updateDocument(docId: string, content: string) {
        // No need to pass user - ServiceB reads it from context
        await serviceB.saveDocument(docId, content)
    }
}

// ServiceB - deeper in the call chain
class ServiceB {
    async saveDocument(docId: string, content: string) {
        if (AuthUserKey.get()?.role !== "admin") throw new FORBIDDEN()
        // ... save document
    }
}
```

## Basic Usage

### Defining a Context Key

```typescript
import {GGContextKey} from "@grest-ts/context"
import {t} from "@grest-ts/schema"

const RequestIdKey = new GGContextKey("requestId", t.string())

// With default value
const DebugModeKey = new GGContextKey("debugMode", t.boolean(), {
    defaultValue: false,
    description: "Enable debug logging for this request"
})
```

### Setting and Accessing Context

```typescript
import {GGContext} from "@grest-ts/context"

new GGContext("request").run(() => {

    // Set context value
    RequestIdKey.set("req-123")

    // Get context value (returns undefined if not set, or defaultValue if defined)
    const requestId = RequestIdKey.get()

    // Check if value exists
    if (RequestIdKey.has()) { ...
    }

    // Assert value exists (throws if not set)
    const id = RequestIdKey.assert()

    // Delete value
    RequestIdKey.delete()

})
```

### Using GGContextStore Static Helpers

```typescript
import {GGContextStore} from "@grest-ts/context"

// Check if context exists
if (GGContextStore.hasContext()) {
    const ctx = GGContextStore.getContext()
}

// Safe access (returns undefined if no context)
const ctx = GGContextStore.tryGetContext()

// Branch from current context (child inherits parent values)
const childCtx = GGContextStore.branch("child-request")
```

## Context Branching

Child contexts inherit parent values but can override them:

```typescript
const parentCtx = new GGContext("parent")
parentCtx.run(() => {
    RequestIdKey.set("req-123")

    const childCtx = GGContextStore.branch("child")
    childCtx.run(() => {
        RequestIdKey.get()  // "req-123" - inherited from parent
        RequestIdKey.set("req-456")  // Override in child
        RequestIdKey.get()  // "req-456"
    })

    RequestIdKey.get()  // "req-123" - parent unchanged
})
```

## Units of work and the sealed root

Each unit of work runs in a fresh context with no parent, so it inherits nothing another unit set:
an HTTP request (raw routes included), a websocket connection, a job run, an event, and a scope timer
(`GGLocator.setTimeout`/`setInterval`) set outside any request. Start your own with `runInFreshContext(name, fn)`
from `@grest-ts/trace`.

A unit of work's context is strict: a key can be set once in it, and a second `set()` throws, so two parts of one
request can't silently overwrite each other's value. A key that must change mid-unit, like the trace, is declared
`new GGContextKey(name, schema, {mutable: true})`. To scope a different value to part of the work, run that part in a
child context instead. A scope timer set inside a unit of work runs in that unit's context, so a repeating one that
sets a key runs its body in a child context.

A runtime runs compose and start in its root context, and **seals** it once running: `set()` on it throws. Code that
still runs there later, such as a raw `setTimeout` or an emitter listener set up in compose, would otherwise leak what
it sets into the runtime itself. Run that code with `runInFreshContext`, or use a scope timer.

## Async Context Helpers

Preserve context across async boundaries:

```typescript
GGContextStore.setTimeout(() => {
    // Context is preserved here
    RequestIdKey.get()
}, 1000)

GGContextStore.setInterval(() => { ...
}, 5000)
GGContextStore.setImmediate(() => { ...
})
```
