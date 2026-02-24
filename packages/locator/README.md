# Locator Package (@grest-ts/locator)

Service locator pattern implementation using AsyncLocalStorage for managing dependency injection in async contexts. Provides type-safe access to services throughout the request lifecycle without
explicit passing.

## When do you need it?

- **Framework level**: The framework uses GGLocator internally to provide access to services like logging, config, databases, etc.
- **Your services**: You can use it to avoid passing service dependencies through deep call stacks. Register once, access anywhere.

Note: GGLocator is for **services** (long-lived dependencies). For request-scoped data (requestId, auth, etc.), use `GGContext` instead.

## Basic Usage

### Defining a Service Key

```typescript
import {GGLocatorKey} from "@grest-ts/locator"

interface UserService {
    getUser(id: string): Promise<User>
}

const UserServiceKey = new GGLocatorKey<UserService>("UserService")
```

### Case study: Dependency injection (DI) in Services

Explicit, manually passing dependencies. This is what you probably would do for smaller services

```typescript
class OrderService {

    private readonly userService: UserService
    private readonly paymentService: PaymentService

    constructor(userService: UserService, paymentService: PaymentService) {
        this.userService = userService
        this.paymentService = paymentService
    }

    async createOrder(userId: string, items: Item[]) {
        const user = await this.userService.getUser(userId)
        return this.paymentService.charge(user, items)
    }
}
```

Using dependency injection via GGLocator keys. Use this when things start getting bigger and you really see value in this.

Pros: Less setup

Cons: Less visibility for dependencies.

```typescript
class OrderService {

    private readonly userService = UserServiceKey.get()
    private readonly paymentService = PaymentServiceKey.get()

    async createOrder(userId: string, items: Item[]) {
        const user = await this.userService.getUser(userId)
        return this.paymentService.charge(user, items)
    }
}
```

What NOT to do:

```typescript
class OrderService {

    async createOrder(userId: string, items: Item[]) {
        // VERY BAD: Keeps the dependency "hidden" and causes issues for your project in the future.
        const user = await UserServiceKey.get().getUser(userId)
        return PaymentServiceKey.get().charge(user, items)
    }
}
```

But when is direct access fine?

You can always define that some "service" is generic and accessible everywhere. This is for you to decide where you draw the line.
Passing Logging, metrics, tracing etc around everywhere can become very tedious, so it is easier to just use inline.

```typescript
class OrderService {

    async createOrder(userId: string, items: Item[]) {
        // Important - all these next examples are still async context scoped.
        GGLog.info(this, "Some log message") // Library itself provides quick access is usually a hint it is meant to be used like this.
        MyMetrics.orders.increment("orders.created") // Metrics are usually defined globally and accessible everywhere.
        const isEnabled = MyConfig.something.somewhere.get() // Config is usually defined globally and accessible everywhere.
    }
}
```

### Registering and Accessing Services

```typescript
import {GGLocatorScope} from "@grest-ts/locator"

// You usually don't need to create the scope, but for the completeness of this example, we create it here.
new GGLocatorScope("something").run(async () => {

    // Set the service
    UserServiceKey.set(new UserServiceImpl())

    // Set the service
    UserServiceKey.overwrite(new UserServiceImpl())

    // Access service anywhere in the call stack
    const userService = UserServiceKey.get() // Throws if service is not set.
    const user = await userService.getUser("123")

    // Optionally get the service
    const userServiceOpt = UserServiceKey.tryGet()
    if (userServiceOpt) {
        const user = await userServiceOpt.getUser("123")
    }

})
```

### Using GGLocator Static Helpers

```typescript
import {GGLocator} from "@grest-ts/locator"

// Check if scope exists
if (GGLocator.hasScope()) {
    const scope = GGLocator.getScope()
}

// Safe access (returns undefined if no scope)
const scope = GGLocator.tryGetScope()
```

## Debugging

To see what services are registered in the current scope:

```typescript
const debugData = GGLocator.getScope().getScopeDebugFull();
console.log(debugData.toString()) // Nicer for console log for a quick peek.
console.log(debugData.toJSON()) // JSON format.
```

This prints the full scope tree with all registered services and their registration stacks - useful for understanding what's available in your current context.

## Scope Branching

Create child scopes that inherit parent services:

```typescript
const rootScope = new GGLocatorScope("root")
rootScope.set(ConfigKey, config)

// Child scope inherits parent services
const requestScope = rootScope.branch("request")
requestScope.set(RequestContextKey, requestContext)

requestScope.run(() => {
    ConfigKey.get()          // Works - inherited from parent
    RequestContextKey.get()  // Works - set in this scope
})
```

## GGLocatorKey Methods

```typescript
const ServiceKey = new GGLocatorKey<MyService>("MyService")

// Get service (throws if not found)
const service = ServiceKey.get()

// Try get service (returns undefined if not found)
const service = ServiceKey.tryGet()

// Check if service exists
if (ServiceKey.has()) { ...
}

// Set service (throws if already set)
ServiceKey.set(new MyService())

// Overwrite service (allows replacing)
ServiceKey.overwrite(new MyService())
```

## Async Context Helpers

Wrap callbacks to preserve scope across async boundaries:

```typescript
// Wrap function to run within current scope
const wrappedFn = GGLocator.wrapWithRun(myCallback)

// Schedule with scope preservation
GGLocator.setTimeout(() => {
    // Scope is preserved here
    ServiceKey.get()
}, 1000)

GGLocator.setInterval(() => { ...
}, 5000)
GGLocator.setImmediate(() => { ...
})
```
