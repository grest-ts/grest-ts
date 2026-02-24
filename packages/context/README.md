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
