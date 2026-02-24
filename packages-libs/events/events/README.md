# Events Package Skill (@grest-ts/events)

## Using Events

The events package provides SNS/SQS-style pub/sub messaging for async communication between services.

### Defining Events

Create an event definition file:

```typescript
// events/UserEvents.api.ts
import { awsSnsPublisher } from "@grest-ts/events-aws"
import { UserEventsContract } from "./UserEvents.gen"

// 1. Define event payload types
export interface UserLoggedInEvent {
    userId: string
    timestamp: number
}

export interface UserRegisteredEvent {
    userId: string
    username: string
    timestamp: number
}

export interface UserPasswordChangedEvent {
    userId: string
    timestamp: number
}

// 2. Define event interface (event name -> handler signature)
export interface UserEvents {
    loggedIn: (event: UserLoggedInEvent) => Promise<void>
    registered: (event: UserRegisteredEvent) => Promise<void>
    passwordChanged: (event: UserPasswordChangedEvent) => Promise<void>
}

// 3. Create publisher
export const UserEventsPublisher = awsSnsPublisher<UserEvents>(
    "user_events",      // Topic name
    UserEventsContract  // Generated contract (from code generation)
)

// 4. Create subscriber with configuration
export const UserEventsSubscriber = UserEventsPublisher.subscriber(
    "my_service_user_events",  // Queue name (unique per subscriber)
    {
        messageRetentionSeconds: 86400,    // 24 hours
        deadLetterAfterRetries: 3,         // Move to DLQ after 3 failures
        visibilityTimeoutDefault: 30       // 30 seconds processing timeout
    }
)
```

### Configuring Events in Config

```typescript
// MyConfig.api.ts
import { GGConfig } from "@grest-ts/config"
import { UserEventsPublisher, UserEventsSubscriber } from "./events/UserEvents.api"

export const MyConfig = GGConfig.define("/my-service/", () => ({
    publisher: {
        userEvents: UserEventsPublisher.config()
    },
    subscriber: {
        userEvents: UserEventsSubscriber.config()
    }
}))
```

### Publishing Events

In your runtime:

```typescript
protected compose(): void {
    // Create publisher from config
    const userEventsPublisher = MyConfig.publisher.userEvents.newPublisher()

    // Pass to services
    const userService = new UserService(userEventsPublisher)
}
```

In your service:

```typescript
import { EventPublisherClient } from "@grest-ts/events"

export class UserService {
    constructor(
        private userEvents: EventPublisherClient<UserEvents>
    ) {}

    async register(request: RegisterRequest): Promise<User> {
        const user = await this.createUser(request)

        // Publish event
        const publishResult = await this.userEvents.publish("registered", {
            userId: user.id,
            username: user.username,
            timestamp: Date.now()
        }).asResult()

        if (!publishResult.success) {
            // Handle publish failure
            console.error("Failed to publish event:", publishResult.error)
        }

        return user
    }

    async login(credentials: LoginRequest): Promise<LoginResponse> {
        const user = await this.validateCredentials(credentials)

        // Fire and forget (no error handling)
        this.userEvents.publish("loggedIn", {
            userId: user.id,
            timestamp: Date.now()
        })

        return { user, token: generateToken() }
    }
}
```

### Subscribing to Events

In a separate service's runtime:

```typescript
protected compose(): void {
    // Create subscriber from config
    MyConfig.subscriber.userEvents.newSubscriber({
        registered: async (event) => {
            GGLog.info(this, `New user registered: ${event.username}`)
            // Process registration event
            await this.welcomeService.sendWelcomeEmail(event.userId)
        },
        loggedIn: async (event) => {
            GGLog.info(this, `User logged in: ${event.userId}`)
            // Track login analytics
        },
        passwordChanged: async (event) => {
            GGLog.info(this, `Password changed: ${event.userId}`)
            // Send security notification
        }
    })
}
```

### Error Handling in Subscribers

```typescript
MyConfig.subscriber.userEvents.newSubscriber({
    registered: async (event) => {
        try {
            await this.processRegistration(event)
        } catch (error) {
            GGLog.error(this, "Failed to process registration", { error, event })
            // Throwing will retry (up to deadLetterAfterRetries)
            throw error
        }
    }
})
```

### Multiple Subscribers

Different services can subscribe to the same events:

```typescript
// Service A - Analytics
export const AnalyticsUserSubscriber = UserEventsPublisher.subscriber(
    "analytics_user_events",
    { messageRetentionSeconds: 3600 }
)

// Service B - Notifications
export const NotificationUserSubscriber = UserEventsPublisher.subscriber(
    "notification_user_events",
    { messageRetentionSeconds: 86400 }
)

// Service C - Audit
export const AuditUserSubscriber = UserEventsPublisher.subscriber(
    "audit_user_events",
    { messageRetentionSeconds: 604800 }  // 7 days
)
```

### Testing Events

```typescript
import { GGTest } from "@grest-ts/testkit"
import { MainRuntime } from "./main"
import { UserEventsPublisher } from "./events/UserEvents.api"

describe("user events", () => {
    const t = GGTest.startWorker(MainRuntime)
    const api = UserApi.createTestClient()

    test("publishes registered event on signup", async () => {
        await api
            .register({ username: "test", email: "test@example.com" })
            .with(UserEventsPublisher.spy.registered
                .toMatchObject({
                    username: "test",
                    timestamp: expect.any(Number)
                }))
    })

    test("subscriber receives event", async () => {
        await api
            .register({ username: "test2", email: "test2@example.com" })
            .waitFor(t.notificationService.logs.expect(/Welcome email sent/))
    })
})
```

### Event Patterns

#### Publish After Success

```typescript
async createOrder(request: CreateOrderRequest): Promise<Order> {
    const order = await this.orderRepository.create(request)

    // Only publish if creation succeeded
    await this.orderEvents.publish("created", {
        orderId: order.id,
        userId: request.userId,
        total: order.total,
        timestamp: Date.now()
    }).asResult()

    return order
}
```

#### Conditional Publishing

```typescript
async updateOrderStatus(orderId: string, status: OrderStatus): Promise<Order> {
    const order = await this.orderRepository.updateStatus(orderId, status)

    // Publish different events based on status
    if (status === "completed") {
        await this.orderEvents.publish("completed", { orderId, timestamp: Date.now() })
    } else if (status === "cancelled") {
        await this.orderEvents.publish("cancelled", { orderId, timestamp: Date.now() })
    }

    return order
}
```

## Extending Events

### Custom Event Publishers

Create specialized publishers:

```typescript
import { awsSnsPublisher } from "@grest-ts/events-aws"

// Domain-specific events
export interface OrderEvents {
    created: (event: OrderCreatedEvent) => Promise<void>
    completed: (event: OrderCompletedEvent) => Promise<void>
    cancelled: (event: OrderCancelledEvent) => Promise<void>
    refunded: (event: OrderRefundedEvent) => Promise<void>
}

export const OrderEventsPublisher = awsSnsPublisher<OrderEvents>(
    "order_events",
    OrderEventsContract
)
```

### Event Payload Design

Best practices for event payloads:

```typescript
// Good: Include enough context
export interface OrderCompletedEvent {
    orderId: string
    userId: string
    items: Array<{ productId: string; quantity: number; price: number }>
    total: number
    completedAt: number
}

// Avoid: Too minimal, forces subscribers to fetch more data
export interface OrderCompletedEventBad {
    orderId: string  // Subscribers need to query for details
}
```
