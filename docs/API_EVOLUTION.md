# API Evolution Patterns

This document describes how APIs naturally evolve as organizations grow, and how the Grest Framework's single-entity auth binding principle enables this evolution without forcing architectural decisions prematurely.

## Table of Contents
- [Overview](#overview)
- [The Evolution Stages](#the-evolution-stages)
  - [Stage 1: Startup (5-10 engineers)](#stage-1-startup-5-10-engineers)
  - [Stage 2: Growth (20-30 engineers)](#stage-2-growth-20-30-engineers)
  - [Stage 3: Scale (100+ engineers)](#stage-3-scale-100-engineers)
- [Decision Framework](#decision-framework)
- [Migration Patterns](#migration-patterns)
- [Why This Works](#why-this-works)
- [Real-World Examples](#real-world-examples)

## Overview

The Grest Framework doesn't prescribe how to structure your APIs - instead, it provides primitives that enable natural evolution as your organization grows. The key insight is that **authentication domains map to team boundaries**, and team boundaries evolve with company size.

**Core Principle:** Each API is bound to a single authentication entity, but entities can be added, split, and composed as needed.

## The Evolution Stages

### Stage 1: Startup (5-10 engineers)

**Characteristics:**
- Single domain team owns everything
- Speed and simplicity are paramount
- No team coordination overhead
- External services (Stripe, Google Maps) used directly

**Pattern: Monolithic Domain API**

```typescript
// One team, one auth domain, everything inline
httpApi<RiderApi>("RiderApi")
    .path("api/rider")
    .auth(RiderAuth, RiderAuthState)
    .sdk("RiderApp")
    .server({
        // Core domain
        getProfile: httpApi.GET("profile"),
        updateProfile: httpApi.PUT("profile"),

        // Payments (inline)
        getPaymentMethods: httpApi.GET("payment-methods"),
        addPaymentMethod: httpApi.POST("payment-methods"),
        makePayment: httpApi.POST("payment"),

        // Maps (inline)
        getRoute: httpApi.POST("route"),
        searchPlaces: httpApi.GET("places"),

        // Notifications (inline)
        getNotifications: httpApi.GET("notifications"),
        markNotificationRead: httpApi.PUT("notifications/:id/read")
    })
```

**Implementation:**

```typescript
class RiderApiImpl implements RiderApi {
    // Direct calls to external services
    async addPaymentMethod(rider: Rider, card: CardDetails) {
        // Call Stripe directly
        return await stripe.customers.createSource(rider.stripeId, card)
    }

    async getRoute(rider: Rider, from: Location, to: Location) {
        // Call Google Maps directly
        return await googleMaps.directions(from, to)
    }

    async sendNotification(rider: Rider, message: string) {
        // Call Firebase directly
        return await firebase.messaging().send(rider.fcmToken, message)
    }
}
```

**Advantages:**
- ✅ Fastest time to market
- ✅ Simple frontend (one auth token)
- ✅ No coordination overhead
- ✅ Easy to understand

**When to evolve:**
- Payment logic becomes complex (fraud detection, multiple providers)
- Multiple teams forming
- Need for specialized expertise (payments compliance, maps optimization)

---

### Stage 2: Growth (20-30 engineers)

**Characteristics:**
- Specialized platform teams forming (Payments, Notifications)
- Domain teams (Rider, Driver) and platform teams need clear boundaries
- Platform teams own business logic, domain teams own UX/integration
- Service-to-service communication emerges

**Pattern: Internal APIs with BFF (Backend for Frontend)**

```typescript
// ============================================
// DOMAIN TEAM: Rider Team
// ============================================
httpApi<RiderApi>("RiderApi")
    .path("api/rider")
    .auth(RiderAuth, RiderAuthState)
    .sdk("RiderApp")
    .server({
        // Core domain (owned by Rider team)
        getProfile: httpApi.GET("profile"),
        updateProfile: httpApi.PUT("profile"),

        // Payments (proxied to Payments team)
        getPaymentMethods: httpApi.GET("payment-methods"),
        addPaymentMethod: httpApi.POST("payment-methods"),
        makePayment: httpApi.POST("payment"),

        // Maps (still direct, not complex enough to split)
        getRoute: httpApi.POST("route"),

        // Notifications (proxied to Notifications team)
        getNotifications: httpApi.GET("notifications")
    })

// ============================================
// PLATFORM TEAM: Payments Team
// ============================================
httpApi<PaymentsInternalApi>("PaymentsInternalApi")
    .path("internal/payments")
    .auth(ServiceAuth, ServiceAuthState)  // Service-to-service auth
    .server({
        // Internal API - not exposed to end users
        getPaymentMethodsForUser: httpApi.GET("payment-methods/:userId"),
        addPaymentMethodForUser: httpApi.POST("payment-methods/:userId"),
        deletePaymentMethodForUser: httpApi.DELETE("payment-methods/:userId/:methodId"),
        processPayment: httpApi.POST("process"),
        refundPayment: httpApi.POST("refund/:transactionId")
    })

// ============================================
// PLATFORM TEAM: Notifications Team
// ============================================
httpApi<NotificationsInternalApi>("NotificationsInternalApi")
    .path("internal/notifications")
    .auth(ServiceAuth, ServiceAuthState)
    .server({
        getNotificationsForUser: httpApi.GET("notifications/:userId"),
        sendNotification: httpApi.POST("send"),
        markAsRead: httpApi.PUT("notifications/:notificationId/read")
    })
```

**Implementation - BFF Pattern:**

```typescript
// Rider team's implementation now delegates to platform teams
class RiderApiImpl implements RiderApi {
    constructor(
        private paymentsClient: PaymentsInternalApiClient,
        private notificationsClient: NotificationsInternalApiClient
    ) {}

    async addPaymentMethod(rider: Rider, card: CardDetails) {
        // Delegate to Payments team's internal API
        return await this.paymentsClient.addPaymentMethodForUser(rider.id, card)
    }

    async getNotifications(rider: Rider) {
        // Delegate to Notifications team's internal API
        return await this.notificationsClient.getNotificationsForUser(rider.id)
    }

    async getRoute(rider: Rider, from: Location, to: Location) {
        // Still direct - not complex enough to warrant platform team
        return await googleMaps.directions(from, to)
    }
}
```

**Advantages:**
- ✅ Clear team ownership (Payments team owns payment logic)
- ✅ Platform teams can evolve independently
- ✅ Still simple for frontend (one auth token)
- ✅ Backend complexity hidden from clients
- ✅ Platform teams can serve multiple domain teams

**When to evolve:**
- Platform teams need to own UI (PCI compliance, specialized flows)
- Complex fraud detection, 3DS authentication required
- Sensitive data entry (credit cards, KYC documents)
- Platform teams growing to 10+ engineers

---

### Stage 3: Scale (100+ engineers)

**Characteristics:**
- Platform teams own complete product areas (UI + backend)
- Compliance requirements (PCI, SOC2, GDPR)
- Complex fraud detection, security features
- Multiple domain teams (Rider, Driver, Merchant) need same platform features

**Pattern: Session-Based Platform Services**

Platform teams create their own authentication domain using session tokens.

```typescript
// ============================================
// DOMAIN TEAM: Rider Team
// ============================================
httpApi<RiderApi>("RiderApi")
    .path("api/rider")
    .auth(RiderAuth, RiderAuthState)
    .sdk("RiderApp")
    .server({
        // Core domain
        getProfile: httpApi.GET("profile"),

        // Simple payment operations (still proxied)
        getPaymentMethods: httpApi.GET("payment-methods"),
        deletePaymentMethod: httpApi.DELETE("payment-methods/:id"),
        setDefaultPaymentMethod: httpApi.PUT("payment-methods/:id/default"),

        // Complex payment flows → create sessions
        createAddCardSession: httpApi.POST("payment-methods/add-session"),
        createPaymentSession: httpApi.POST("payment/session"),

        // KYC verification → session-based
        createKycSession: httpApi.POST("kyc/session"),

        // Maps might split out too
        getRoute: httpApi.POST("route")
    })

// ============================================
// PLATFORM TEAM: Payments Team (Public UI)
// ============================================

// Internal API (for creating sessions)
httpApi<PaymentsInternalApi>("PaymentsInternalApi")
    .path("internal/payments")
    .auth(ServiceAuth, ServiceAuthState)
    .server({
        createSession: httpApi.POST("sessions/create"),
        getPaymentMethodsForUser: httpApi.GET("payment-methods/:userId"),
        deletePaymentMethodForUser: httpApi.DELETE("payment-methods/:userId/:methodId")
    })

// Payment Session API (user-facing UI)
httpApi<PaymentSessionApi>("PaymentSessionApi")
    .path("payments")
    .auth(PaymentSessionAuth, PaymentSessionAuthState)  // Own auth domain!
    .server({
        // Sensitive operations in Payments-owned UI
        getSessionDetails: httpApi.GET("session/details"),
        addPaymentMethod: httpApi.POST("add-payment-method"),
        submitPayment: httpApi.POST("submit"),
        verify3DS: httpApi.POST("verify-3ds"),
        handleFraudCheck: httpApi.POST("fraud-check")
    })

// ============================================
// PLATFORM TEAM: KYC Team
// ============================================
httpApi<KycSessionApi>("KycSessionApi")
    .path("kyc")
    .auth(KycSessionAuth, KycSessionAuthState)  // Own auth domain!
    .server({
        getSessionDetails: httpApi.GET("session/details"),
        uploadDocument: httpApi.POST("upload-document"),
        submitForVerification: httpApi.POST("submit"),
        checkVerificationStatus: httpApi.GET("status")
    })
```

**Implementation - Session Flow:**

```typescript
// ============================================
// RIDER TEAM: Create payment session
// ============================================
class RiderApiImpl implements RiderApi {
    async createPaymentSession(rider: Rider, amount: number, methodId: string) {
        // Call Payments internal API to create session
        const session = await paymentsInternalClient.createSession({
            userId: rider.id,
            userType: 'rider',
            amount,
            paymentMethodId: methodId,
            metadata: { rideId: rider.currentRideId }
        })

        return {
            sessionToken: session.sessionToken,
            redirectUrl: `/payments/checkout?token=${session.sessionToken}`
        }
    }
}

// ============================================
// PAYMENTS TEAM: Session-based operations
// ============================================
class PaymentSessionApiImpl implements PaymentSessionApi {
    async submitPayment(session: PaymentSession, methodId: string) {
        // Full fraud detection, 3DS, compliance checks
        await this.fraudDetection.check(session)

        if (this.requires3DS(session)) {
            return { requiresVerification: true, verificationUrl: '...' }
        }

        const result = await this.paymentProcessor.charge({
            amount: session.amount,
            paymentMethodId: methodId,
            userId: session.userId
        })

        await this.auditLog.record({
            sessionId: session.id,
            action: 'payment_submitted',
            result
        })

        return result
    }
}
```

**Frontend Flow:**

```typescript
// ============================================
// Rider App (Frontend)
// ============================================

// 1. User authenticated with RiderAuth
const riderClient = new RiderApiClient(riderAuthState)

// 2. Get payment methods (simple operation)
const methods = await riderClient.getPaymentMethods()

// 3. Make payment (complex operation → session)
const session = await riderClient.createPaymentSession(2500, 'pm_1234')

// 4. Redirect to Payments UI (or embed in iframe)
window.location = session.redirectUrl

// ============================================
// Payments UI (Owned by Payments Team)
// ============================================

// 5. Payments UI extracts session token
const sessionToken = new URLSearchParams(window.location.search).get('token')

// 6. Create Payments client with session auth
const paymentClient = new PaymentSessionApiClient(sessionToken)

// 7. User completes payment in Payments UI
const result = await paymentClient.submitPayment('pm_1234')

// 8. Redirect back to Rider app
window.location = `rideshare://payment-complete?result=${result.id}`
```

**Advantages:**
- ✅ Platform teams fully autonomous (own UI, backend, auth)
- ✅ Strong security boundaries (session tokens scoped and temporary)
- ✅ Compliance-friendly (Payments team controls PCI environment)
- ✅ Scales to many domain teams (Rider, Driver, Merchant all use same Payments UI)
- ✅ Platform teams can evolve UI independently

**Tradeoffs:**
- ⚠️ More tokens to manage
- ⚠️ More complex frontend flows (session creation, redirects)
- ⚠️ Requires frontend abstractions (session managers, UI components)

---

## Decision Framework

### When to use each pattern:

| Pattern | When | Teams | Example Use Cases |
|---------|------|-------|-------------------|
| **Monolithic Domain API** | Single team, simple logic, speed critical | 1 team | MVP, early startup, simple CRUD |
| **Internal API + BFF** | Platform team exists, shared logic, domain teams control UX | 2-5 teams | Payments CRUD, notifications, analytics |
| **Session-Based Platform** | Platform owns UI, sensitive data, compliance | 5+ teams | Payment checkout, KYC, document signing |
| **No Auth / Public** | Pure utility, stateless, no sensitive data | Any | Geocoding, currency conversion, health checks |

### Questions to ask when designing an API:

1. **Who owns this functionality?**
   - Same team as domain → Monolithic
   - Different team, simple integration → Internal API
   - Different team, owns UI → Session-based

2. **Is there sensitive data?**
   - Credit cards, SSN, documents → Session-based
   - User preferences, settings → Domain or Internal
   - Public data → No auth

3. **How many domain teams need this?**
   - One team → Can stay in domain
   - Multiple teams → Internal API
   - Multiple teams + complex UI → Session-based

4. **What are the compliance requirements?**
   - PCI, SOC2, HIPAA → Session-based (isolated environment)
   - Basic security → Domain or Internal
   - Public → No auth

5. **How complex is the business logic?**
   - Simple CRUD → Domain API
   - Moderate complexity → Internal API
   - Complex workflows, fraud detection → Session-based

---

## Migration Patterns

### Example: Evolving Payments from Stage 1 → Stage 3

**Week 1: Stage 1 (Monolithic)**
```typescript
interface RiderApi {
    addPaymentMethod: (rider: Rider, card: CardDetails) => GGPromise<PaymentMethod>
    makePayment: (rider: Rider, methodId: string, amount: number) => GGPromise<Payment>
}
```

**Week 10: Stage 2 (Internal API introduced)**
```typescript
// Public API unchanged - backwards compatible!
interface RiderApi {
    addPaymentMethod: (rider: Rider, card: CardDetails) => GGPromise<PaymentMethod>
    makePayment: (rider: Rider, methodId: string, amount: number) => GGPromise<Payment>
}

// Implementation now delegates
class RiderApiImpl implements RiderApi {
    async addPaymentMethod(rider: Rider, card: CardDetails) {
        return await paymentsInternalClient.addPaymentMethodForUser(rider.id, card)
    }
}
```

**Week 20: Stage 3 (Session-based introduced, old API deprecated)**
```typescript
interface RiderApi {
    // Old methods - deprecated
    /** @deprecated Use createAddCardSession instead */
    addPaymentMethod: (rider: Rider, card: CardDetails) => GGPromise<PaymentMethod>

    // New methods - session-based
    createAddCardSession: (rider: Rider) => GGPromise<PaymentSession>
    createPaymentSession: (rider: Rider, amount: number, methodId: string) => GGPromise<PaymentSession>

    // Simple CRUD stays
    getPaymentMethods: (rider: Rider) => GGPromise<PaymentMethod[]>
    deletePaymentMethod: (rider: Rider, methodId: string) => GGPromise<void>
}
```

**Week 30: Stage 3 (Old API removed)**
```typescript
interface RiderApi {
    // Only session-based for complex flows
    createAddCardSession: (rider: Rider) => GGPromise<PaymentSession>
    createPaymentSession: (rider: Rider, amount: number, methodId: string) => GGPromise<PaymentSession>

    // Simple CRUD operations stay in domain
    getPaymentMethods: (rider: Rider) => GGPromise<PaymentMethod[]>
    deletePaymentMethod: (rider: Rider, methodId: string) => GGPromise<void>
}
```

### Key Migration Principles:

1. **Backwards compatibility during transition** - Old and new APIs coexist
2. **Deprecation warnings** - Give clients time to migrate
3. **Simple operations can stay in domain** - Only complex flows need sessions
4. **Internal implementation can change without breaking clients** - BFF pattern enables this

---

## Why This Works

### The Framework's Key Enablers:

**1. Single-Entity Binding Creates Clarity**
```typescript
// Each auth domain is explicit
.auth(RiderAuth, RiderAuthState)                    // Rider domain
.auth(PaymentSessionAuth, PaymentSessionAuthState)  // Payment domain
.auth(ServiceAuth, ServiceAuthState)                // Service domain
```

Every API declares its authentication domain upfront. No ambiguity.

**2. Entities Can Be Added Without Breaking Existing APIs**
```typescript
// Week 1: Only Rider exists
httpApi<RiderApi>("RiderApi").auth(RiderAuth, RiderAuthState)

// Week 10: Add PaymentSession entity
httpApi<PaymentSessionApi>("PaymentSessionApi")
    .auth(PaymentSessionAuth, PaymentSessionAuthState)

// Rider API unchanged!
```

**3. Sessions Are Just Entities**
```typescript
// No special framework handling needed
// PaymentSession is just another auth domain
class PaymentSessionAuthState extends GGAuthState<...> {
    userId: string       // Original user who created session
    amount: number       // Session-specific data
    expiresAt: number    // Sessions are temporary
}
```

**4. Teams Choose Their Own Complexity**
```typescript
// Team A: Stays simple
httpApi<LoyaltyApi>("LoyaltyApi")
    .auth(RiderAuth, RiderAuthState)
    .server({ getPoints: httpApi.GET("points") })

// Team B: Uses internal APIs
httpApi<PaymentsInternalApi>("PaymentsInternalApi")
    .auth(ServiceAuth, ServiceAuthState)
    .server({ processPayment: httpApi.POST("process") })

// Team C: Uses sessions
httpApi<KycSessionApi>("KycSessionApi")
    .auth(KycSessionAuth, KycSessionAuthState)
    .server({ uploadDocument: httpApi.POST("upload") })
```

All valid, all type-safe, all within the same framework.

**5. Migration Is Incremental**

You don't need to migrate everything at once. Mix and match:
- Payments → Session-based (high security needs)
- Notifications → Internal API (shared logic)
- Loyalty → Domain API (simple, low priority)

---

## Real-World Examples

### Example 1: Ride-Sharing Platform

**Stage 1 (Startup):**
```typescript
// Everything in RiderApi and DriverApi
httpApi<RiderApi>("RiderApi").auth(RiderAuth, RiderAuthState).server({
    requestRide, cancelRide, rateDriver,
    addPaymentMethod, getPaymentMethods, // Inline payments
    getRoute, searchPlaces               // Inline maps
})
```

**Stage 2 (Growth):**
```typescript
// Payments team formed
httpApi<RiderApi>("RiderApi").server({
    requestRide, cancelRide, rateDriver,
    addPaymentMethod, getPaymentMethods  // Proxied to PaymentsInternal
})

httpApi<PaymentsInternalApi>("PaymentsInternalApi")
    .auth(ServiceAuth, ServiceAuthState)
    .server({ processPayment, refund, ... })
```

**Stage 3 (Scale):**
```typescript
// Payments owns UI for compliance
httpApi<RiderApi>("RiderApi").server({
    requestRide, cancelRide, rateDriver,
    createPaymentSession                 // Session-based
})

httpApi<PaymentSessionApi>("PaymentSessionApi")
    .auth(PaymentSessionAuth, PaymentSessionAuthState)
    .server({ submitPayment, verify3DS, ... })
```

### Example 2: E-Commerce Platform

**Evolution of checkout flow:**

**Stage 1:** Everything in `CustomerApi` - cart, checkout, payment inline
**Stage 2:** `PaymentsInternalApi` handles processing, `CustomerApi` proxies
**Stage 3:** `CheckoutSessionApi` owns entire checkout UI (cart + payment + shipping)

```typescript
// Customer creates checkout session
httpApi<CustomerApi>("CustomerApi").server({
    createCheckoutSession: (customer: Customer, cartId: string)
        => GGPromise<CheckoutSession>
})

// Checkout UI is owned by Checkout team
httpApi<CheckoutSessionApi>("CheckoutSessionApi")
    .auth(CheckoutSessionAuth, CheckoutSessionAuthState)
    .server({
        getCart: httpApi.GET("cart"),
        updateShipping: httpApi.PUT("shipping"),
        applyPromoCode: httpApi.POST("promo"),
        submitOrder: httpApi.POST("submit")
    })
```

### Example 3: SaaS Platform

**Multiple product areas with different evolution stages:**

```typescript
// User management - Stage 1 (simple, stays in domain)
httpApi<UserApi>("UserApi")
    .auth(UserAuth, UserAuthState)
    .server({ getProfile, updateProfile, ... })

// Billing - Stage 3 (complex, session-based)
httpApi<BillingSessionApi>("BillingSessionApi")
    .auth(BillingSessionAuth, BillingSessionAuthState)
    .server({ updateSubscription, addPaymentMethod, ... })

// Analytics - Stage 2 (internal API)
httpApi<AnalyticsInternalApi>("AnalyticsInternalApi")
    .auth(ServiceAuth, ServiceAuthState)
    .server({ trackEvent, getReport, ... })

// Feature flags - Stage 1 (simple)
httpApi<UserApi>("UserApi")
    .auth(UserAuth, UserAuthState)
    .server({ getFeatureFlags, ... })
```

---

## Conclusion

The Grest Framework's single-entity authentication binding doesn't constrain architectural choices - it enables evolution:

- **Startups** can move fast with simple, monolithic domain APIs
- **Growing companies** can introduce platform teams with internal APIs
- **Large organizations** can build autonomous platform teams with session-based services

The key insight: **Authentication domains map to team boundaries**, and the framework makes these boundaries explicit and type-safe at every stage.

Your architecture can evolve naturally as your organization grows, without being forced into premature complexity or locked into limiting patterns.
