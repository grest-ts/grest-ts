# SPEC: Direct Service Discovery for In-Process API Calls

**Version:** 1.0
**Status:** Draft
**Author:** Grest Framework Team
**Date:** 2025-01-16

---

## Overview

Direct Service Discovery enables API calls to bypass the HTTP layer when both client and server exist in the same process. This provides significant performance improvements for testing, development, and deployment scenarios where multiple services run in a single instance.

---

## Goals

1. **Zero-overhead in-process calls** - Direct function invocation when services are co-located
2. **Transparent to application code** - Existing client/server code works unchanged
3. **Automatic fallback** - Seamlessly uses HTTP when services are in different processes
4. **Production-ready** - Support real deployments, not just testing
5. **Static singleton pattern** - Process-global registry for simplicity

---

## Non-Goals

1. **Cross-process direct calls** - Only same-process optimization
2. **Protocol negotiation** - No dynamic protocol selection beyond "direct or HTTP"
3. **Load balancing** - Single-process only, no distribution
4. **Partial registration** - Service either fully registered for direct access or not at all

---

## Architecture

### Component: `DirectDiscovery` (Static Singleton)

**Purpose:** Global registry that stores handler resolvers for APIs available in the current process.

**Location:** `packages/discovery/src/DirectDiscovery.ts`

**Pattern:** Static class (singleton), process-global state

**Why Static:**
- Single process = single registry
- Simpler than instance management
- Faster lookup (no getInstance() indirection)
- Natural fit for the use case

---

## API Design

### DirectDiscovery Class

```typescript
/**
 * Global registry for direct in-process API calls.
 *
 * When an API is registered here, clients in the same process can call
 * handler functions directly, bypassing HTTP entirely.
 *
 * This is a static singleton - one registry per process.
 */
export class DirectDiscovery {

    /**
     * Registry of API name -> route resolver
     */
    private static handlers = new Map<string, HttpRouteResolver>();

    /**
     * Register an API for direct access.
     *
     * @param apiName - The API name (e.g., "ChecklistApi")
     * @param resolver - The route resolver containing all handlers
     *
     * @example
     * DirectDiscovery.register("ChecklistApi", routeResolver);
     */
    public static register(apiName: string, resolver: HttpRouteResolver): void {
        if (this.handlers.has(apiName)) {
            throw new Error(`DirectDiscovery: API "${apiName}" is already registered`);
        }
        this.handlers.set(apiName, resolver);
    }

    /**
     * Unregister an API from direct access.
     * Useful for testing cleanup.
     *
     * @param apiName - The API name to unregister
     */
    public static unregister(apiName: string): void {
        this.handlers.delete(apiName);
    }

    /**
     * Get direct handler for an API call.
     * Returns undefined if API not registered or route not found.
     *
     * @param apiName - The API name
     * @param method - HTTP method (GET, POST, etc.)
     * @param path - The route path (e.g., "/api/checklist/add")
     * @returns Handler info or undefined if not available
     *
     * @example
     * const handler = DirectDiscovery.getHandler("ChecklistApi", "POST", "/api/checklist/add");
     * if (handler) {
     *   // Use direct call
     * } else {
     *   // Fall back to HTTP
     * }
     */
    public static getHandler(
        apiName: string,
        method: HttpMethod,
        path: string
    ): DirectHandler | undefined {
        const resolver = this.handlers.get(apiName);
        if (!resolver) {
            return undefined; // API not registered for direct access
        }

        const result = resolver.resolve(method, path);
        if (!result) {
            return undefined; // Route not found
        }

        return {
            definition: result.definition,
            pathParams: result.pathParams
        };
    }

    /**
     * Check if an API is available for direct access.
     *
     * @param apiName - The API name
     * @returns true if API is registered
     */
    public static isAvailable(apiName: string): boolean {
        return this.handlers.has(apiName);
    }

    /**
     * Clear all registrations.
     * Primarily for testing - resets the registry to empty state.
     */
    public static clear(): void {
        this.handlers.clear();
    }

    /**
     * Get count of registered APIs.
     * Useful for debugging and monitoring.
     */
    public static getRegisteredCount(): number {
        return this.handlers.size;
    }
}
```

### DirectHandler Type

```typescript
/**
 * Information needed to execute a handler directly.
 */
export interface DirectHandler {
    /**
     * The complete route definition with handler, validators, auth config
     */
    definition: RouteDefinition;

    /**
     * Path parameters extracted from the URL
     * e.g., for "/items/:id" with path "/items/123" -> { id: "123" }
     */
    pathParams: Record<string, string>;
}
```

---

## Integration Points

### 1. GGHttp Registration

**File:** `packages/http/src/http/server/GGHttp.ts`

**Modification:** Register with DirectDiscovery during API registration

```typescript
public registerHttpApi(api: ApiDefinition): void {
    // ... existing route registration code ...

    const routesForResolver: RouteDefinition[] = [];
    api.methods.forEach(route => {
        routesForResolver.push({
            ...route,
            path: api.pathPrefix + route.pathSuffix,
            apiName: api.apiName,
            pathPrefix: api.pathPrefix,
            noAuth: api.noAuth,
            authStrategy: api.authStrategy,
            validators: route.validators
        })
    })

    routesForResolver.forEach(definition => {
        this.routeResolver.register(definition);
    })

    // NEW: Register for direct access
    DirectDiscovery.register(api.apiName, this.routeResolver);

    // ... existing service discovery registration ...
}
```

**Alternative - Explicit Opt-in:**

```typescript
public registerHttpApi(api: ApiDefinition, options?: {
    directAccess?: boolean
}): void {
    // ... registration code ...

    // Only register if explicitly enabled
    if (options?.directAccess !== false) {  // Default true
        DirectDiscovery.register(api.apiName, this.routeResolver);
    }
}
```

### 2. GGHttpClient Direct Call Check

**File:** `packages/http/src/http/client/GGHttpClient.ts`

**Modification:** Check DirectDiscovery before HTTP

```typescript
public request<SuccessData, ErrorsUnion extends GGHttpError = never>(
    method: HttpMethod,
    path: string,
    data: RequestData,
    validators: RequestDataValidators & ResponseDataValidators
): GGResultPromise<SuccessData, ErrorsUnion> {
    const promise = GGSecureRequestHandler.secureRequestResponse(
        {method, path},
        data,
        validators,
        async (validated) => {
            // NEW: Check for direct handler first
            const directHandler = DirectDiscovery.getHandler(
                this.api!,
                method,
                path
            );

            if (directHandler) {
                return this.executeDirect(directHandler, validated);
            }

            // EXISTING: HTTP flow
            const discovery = this.discoveryPromise
                ? await this.discoveryPromise
                : undefined;
            const baseUrl = this.config.url ?? await discovery!.discoverApi(this.api!);

            const url = this.constructUrl(baseUrl, path, validated.path, validated.query);
            const response = await fetch(url, {
                method: method,
                headers: this.buildHeaders(),
                body: validated.body ? JSON.stringify(validated.body) : undefined
            });

            return GGHttpErrorFactory.ensure(
                await response.json(),
                validators?.errors
            );
        },
        this.config.skipValidation
    );

    return new GGResultPromise<SuccessData, ErrorsUnion>(promise);
}
```

### 3. Direct Execution Implementation

**File:** `packages/http/src/http/client/GGHttpClient.ts`

**New Method:** Execute handler directly

```typescript
/**
 * Execute a handler directly without HTTP.
 *
 * This is called when the API is available in the same process via DirectDiscovery.
 *
 * @param directHandler - The handler info from DirectDiscovery
 * @param validated - Already validated request data
 * @returns Response in standard OK_RES format
 */
private async executeDirect(
    directHandler: DirectHandler,
    validated: RequestData
): Promise<OK_RES<any>> {
    const definition = directHandler.definition;

    // Prepare request data with path params
    const requestData: RequestData = {
        path: directHandler.pathParams,
        query: validated.query,
        body: validated.body
    };

    // Authentication handling
    let user: any = undefined;

    if (!definition.noAuth) {
        // Get auth token from auth state
        const token = this.authState?.getToken();

        if (!token) {
            // Return NOT_AUTHORIZED error
            return {
                success: false,
                statusCode: HttpStatusCode.Unauthorized401,
                type: R.NOT_AUTHORIZED,
                refId: crypto.randomUUID(),
                timestamp: Date.now(),
                message: "Authentication required"
            } as NOT_AUTHORIZED_RES;
        }

        // Decode token (simple base64 decode, matches server behavior)
        try {
            const decoded = JSON.parse(
                Buffer.from(token.split('.')[1], 'base64').toString()
            );
            user = decoded;

            // Validate user with auth validator if present
            if (definition.authValidator) {
                const validationResult = definition.authValidator(user);
                if (!validationResult.valid) {
                    throw new Error("User validation failed");
                }
            }
        } catch (err) {
            return {
                success: false,
                statusCode: HttpStatusCode.Unauthorized401,
                type: R.NOT_AUTHORIZED,
                refId: crypto.randomUUID(),
                timestamp: Date.now(),
                message: "Invalid authentication token"
            } as NOT_AUTHORIZED_RES;
        }
    }

    // Execute handler with auth strategy if present
    const exec = async () => {
        const data = await definition.handler(user, requestData);
        return {
            success: true,
            statusCode: HttpStatusCode.OK200,
            type: R.OK,
            data: data
        } satisfies OK_RES<any>;
    };

    if (definition.authStrategy) {
        return definition.authStrategy.run(user, exec);
    } else {
        return exec();
    }
}
```

---

## Data Flow

### Scenario 1: Direct Call (Same Process)

```
┌─────────────────┐
│   Test/Client   │
└────────┬────────┘
         │ client.checklist.add({...})
         ▼
┌─────────────────────────────────┐
│  GGHttpClient.request()         │
│  1. Check DirectDiscovery       │──┐
└─────────────────────────────────┘  │
                                      │
         ┌────────────────────────────┘
         │ Found!
         ▼
┌─────────────────────────────────┐
│  DirectDiscovery.getHandler()   │
│  - Lookup "ChecklistApi"        │
│  - Resolve route                │
│  - Return handler + validators  │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  GGHttpClient.executeDirect()   │
│  1. Decode auth token           │
│  2. Validate user               │
│  3. Call handler(user, data)    │◄─── Direct function call!
│  4. Return OK_RES               │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────┐
│   Test/Client   │
│   (result)      │
└─────────────────┘

Total time: ~0.1ms (no HTTP overhead)
```

### Scenario 2: HTTP Call (Different Process)

```
┌─────────────────┐
│   Test/Client   │
└────────┬────────┘
         │ client.checklist.add({...})
         ▼
┌─────────────────────────────────┐
│  GGHttpClient.request()         │
│  1. Check DirectDiscovery       │──┐
└─────────────────────────────────┘  │
                                      │
         ┌────────────────────────────┘
         │ Not found
         ▼
┌─────────────────────────────────┐
│  Service Discovery              │
│  - Resolve URL                  │
│  - Return http://localhost:8080 │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  fetch(url, ...)                │──── HTTP request ────┐
└────────┬────────────────────────┘                      │
         │                                               │
         │ ◄──── HTTP response ────────────────────────┐│
         │                                              ││
         ▼                                              ││
┌─────────────────┐                        ┌───────────▼▼──────────┐
│   Test/Client   │                        │  Server Process       │
│   (result)      │                        │  - Parse HTTP         │
└─────────────────┘                        │  - Route              │
                                           │  - Auth               │
                                           │  - Call handler       │
                                           └───────────────────────┘

Total time: ~10ms (HTTP overhead)
```

---

## Use Cases

### Use Case 1: Testing (Primary)

**Scenario:** Integration tests with heavy API traffic

**Before (HTTP):**
```typescript
test("create 100 items", async () => {
    for (let i = 0; i < 100; i++) {
        await client.checklist.add({ title: `Item ${i}` });
    }
    // 100 HTTP calls × 10ms = 1000ms
});
```

**After (Direct):**
```typescript
test("create 100 items", async () => {
    for (let i = 0; i < 100; i++) {
        await client.checklist.add({ title: `Item ${i}` });
    }
    // 100 direct calls × 0.05ms = 5ms
});
```

**Setup:** No changes needed - DirectDiscovery automatically registered during runtime composition

**Speedup:** 200x for HTTP overhead, ~2x overall (accounting for business logic)

### Use Case 2: Development (Single Instance)

**Scenario:** Developer running all services locally

**Setup:**
```typescript
// runtime.ts
export class AllInOneRuntime extends GGRuntime {
    protected compose(): void {
        const http = new GGHttp();

        // Register all services
        ChecklistApiServer.start(http, auth, checklistService);
        UserApiServer.start(http, auth, userService);
        NotificationApiServer.start(http, auth, notificationService);
        // ... 8 more services

        // All services now available via DirectDiscovery
        // Cross-service calls are direct, not HTTP
    }
}
```

**Benefit:** Instant feedback, full stack traces, easy debugging

### Use Case 3: Production (Cost Optimization)

**Scenario:** Startup with low traffic, wants to minimize infrastructure costs

**Architecture:**
```
┌─────────────────────────────────────────────┐
│  Single EC2 Instance (3 replicas for HA)    │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  AllServicesRuntime                 │   │
│  │  - UserApi ─────┐                   │   │
│  │  - ChecklistApi │ Direct calls      │   │
│  │  - NotificationApi ◄──┘             │   │
│  │  - PaymentApi ◄────┐                │   │
│  │  - AnalyticsApi ───┘                │   │
│  │  - ... 5 more APIs                  │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘

Later, when traffic grows:
- Split PaymentApi to separate instances → Automatic HTTP fallback
- Split UserApi to separate instances → Automatic HTTP fallback
- Keep remaining services together → Still using DirectDiscovery
```

**Cost Savings:**
- Before: 10 services × 3 instances × $50/month = $1,500/month
- After: 1 runtime × 3 instances × $100/month = $300/month
- **Savings: $1,200/month** (80% reduction)

### Use Case 4: Production (Gradual Service Split)

**Scenario:** As traffic increases, split services incrementally

**Phase 1 - All together:**
```typescript
// all-runtime.ts
AllServicesRuntime.compose(); // All APIs registered with DirectDiscovery
```

**Phase 2 - Split high-traffic service:**
```typescript
// core-runtime.ts (8 services)
CoreRuntime.compose(); // Still using DirectDiscovery for internal calls

// payment-runtime.ts (1 service, separate deployment)
PaymentRuntime.compose(); // Standalone
```

**Result:** Core services call each other directly, call PaymentApi via HTTP (automatic fallback)

---

## Configuration

### Option 1: Automatic (Recommended)

DirectDiscovery enabled by default. No configuration needed.

```typescript
// GGHttp.registerHttpApi() automatically calls:
DirectDiscovery.register(api.apiName, this.routeResolver);
```

**Pros:** Zero config, works everywhere
**Cons:** Always enabled (minor memory overhead)

### Option 2: Explicit Opt-in

Require explicit enablement.

```typescript
// grest.config.ts or runtime options
export default defineConfig({
    enableDirectDiscovery: true  // Default: false
});

// Or per-API
httpServer.registerHttpApi(apiDefinition, { directAccess: true });
```

**Pros:** Explicit control, can disable if issues
**Cons:** Extra configuration, easy to forget

### Option 3: Environment-based

Enable based on environment.

```typescript
// Automatic based on NODE_ENV
const enableDirect = process.env.NODE_ENV === 'test'
    || process.env.ENABLE_DIRECT_DISCOVERY === 'true';

if (enableDirect) {
    DirectDiscovery.register(api.apiName, this.routeResolver);
}
```

**Pros:** Different behavior per environment
**Cons:** Behavior differs between test/prod (risk of bugs)

**Recommendation:** Option 1 (Automatic) - simplest, most benefits, minimal risk

---

## Error Handling

### Error Scenarios

1. **API not registered**
   - DirectDiscovery.getHandler() returns undefined
   - Client falls back to HTTP automatically
   - No error, transparent

2. **Route not found**
   - DirectDiscovery.getHandler() returns undefined
   - Client falls back to HTTP
   - HTTP layer returns 404 if route doesn't exist

3. **Duplicate registration**
   - DirectDiscovery.register() throws error
   - Prevents configuration mistakes
   - Fail fast at startup

4. **Auth failure**
   - executeDirect() returns NOT_AUTHORIZED_RES
   - Same behavior as HTTP auth failure
   - Client handles normally

5. **Handler throws error**
   - Error propagates naturally
   - Client receives error (not wrapped in HTTP)
   - Better stack traces (feature, not bug)

### Error Handling Code

```typescript
// Duplicate registration protection
public static register(apiName: string, resolver: HttpRouteResolver): void {
    if (this.handlers.has(apiName)) {
        throw new Error(
            `DirectDiscovery: API "${apiName}" is already registered. ` +
            `This usually means the API is registered in multiple runtimes ` +
            `in the same process, which is not supported.`
        );
    }
    this.handlers.set(apiName, resolver);
}

// Graceful fallback in client
const directHandler = DirectDiscovery.getHandler(this.api!, method, path);
if (directHandler) {
    try {
        return await this.executeDirect(directHandler, validated);
    } catch (err) {
        // Log unexpected error but don't hide it
        console.error(`DirectDiscovery: Error in direct call to ${this.api}:`, err);
        throw err; // Re-throw - want tests to fail if handler broken
    }
}
```

---

## Testing Strategy

### Unit Tests

**Test:** DirectDiscovery class

```typescript
describe("DirectDiscovery", () => {
    afterEach(() => {
        DirectDiscovery.clear();
    });

    it("should register and retrieve handler", () => {
        const resolver = new HttpRouteResolver();
        DirectDiscovery.register("TestApi", resolver);

        const handler = DirectDiscovery.getHandler("TestApi", "GET", "/test");
        expect(handler).toBeDefined();
    });

    it("should return undefined for unregistered API", () => {
        const handler = DirectDiscovery.getHandler("UnknownApi", "GET", "/test");
        expect(handler).toBeUndefined();
    });

    it("should throw on duplicate registration", () => {
        const resolver = new HttpRouteResolver();
        DirectDiscovery.register("TestApi", resolver);

        expect(() => {
            DirectDiscovery.register("TestApi", resolver);
        }).toThrow("already registered");
    });

    it("should clear all registrations", () => {
        DirectDiscovery.register("Api1", new HttpRouteResolver());
        DirectDiscovery.register("Api2", new HttpRouteResolver());
        expect(DirectDiscovery.getRegisteredCount()).toBe(2);

        DirectDiscovery.clear();
        expect(DirectDiscovery.getRegisteredCount()).toBe(0);
    });
});
```

**Test:** Client direct execution

```typescript
describe("GGHttpClient direct execution", () => {
    it("should use direct call when API registered", async () => {
        // Setup
        const runtime = new TestRuntime();
        await runtime.compose();

        const client = new ChecklistApiClient(auth, { url: "http://localhost:8080" });

        // Spy to verify no HTTP call
        const fetchSpy = jest.spyOn(global, 'fetch');

        // Execute
        const result = await client.add({ title: "Test", description: "Test" });

        // Verify
        expect(result.success).toBe(true);
        expect(fetchSpy).not.toHaveBeenCalled(); // No HTTP!
    });

    it("should fall back to HTTP when API not registered", async () => {
        DirectDiscovery.clear(); // Ensure nothing registered

        const client = new ChecklistApiClient(auth, { url: "http://localhost:8080" });
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ success: true, data: {...} }))
        );

        await client.add({ title: "Test" });

        expect(fetchSpy).toHaveBeenCalled(); // Used HTTP
    });
});
```

### Integration Tests

**Test:** Full flow with authentication

```typescript
describe("DirectDiscovery integration", () => {
    it("should execute authenticated call directly", async () => {
        const runtime = new ChecklistRuntime();
        await runtime.compose();

        // Login to get token
        const auth = new UserAuthState();
        const loginResult = await userClient.login({ username: "test", password: "test" });
        auth.setLoggedIn(loginResult.data);

        // Create authenticated client
        const client = new ChecklistApiClient(auth, {});

        // Call should execute directly with auth
        const result = await client.add({ title: "Test" });

        expect(result.success).toBe(true);
        expect(result.data.createdBy).toBe("test"); // Auth worked
    });

    it("should return NOT_AUTHORIZED for missing token", async () => {
        const runtime = new ChecklistRuntime();
        await runtime.compose();

        const auth = new UserAuthState(); // No login
        const client = new ChecklistApiClient(auth, {});

        const result = await client.add({ title: "Test" });

        expect(result.success).toBe(false);
        expect(result.type).toBe("NOT_AUTHORIZED");
    });
});
```

### Performance Tests

**Test:** Measure speedup

```typescript
describe("DirectDiscovery performance", () => {
    it("should be faster than HTTP", async () => {
        const runtime = new ChecklistRuntime();
        await runtime.compose();

        const client = new ChecklistApiClient(auth, {});

        // Warmup
        await client.add({ title: "Warmup" });

        // Direct calls
        const directStart = Date.now();
        for (let i = 0; i < 100; i++) {
            await client.add({ title: `Item ${i}` });
        }
        const directTime = Date.now() - directStart;

        // Clear registry, force HTTP
        DirectDiscovery.clear();

        // HTTP calls
        const httpStart = Date.now();
        for (let i = 0; i < 100; i++) {
            await client.add({ title: `Item ${i}` });
        }
        const httpTime = Date.now() - httpStart;

        console.log(`Direct: ${directTime}ms, HTTP: ${httpTime}ms`);
        expect(directTime).toBeLessThan(httpTime * 0.5); // At least 2x faster
    });
});
```

---

## Implementation Checklist

### Phase 1: Core Implementation

- [ ] Create `DirectDiscovery` class in `packages/discovery/src/DirectDiscovery.ts`
- [ ] Add `DirectHandler` interface
- [ ] Export from `packages/discovery/src/index.ts`
- [ ] Add unit tests for DirectDiscovery

### Phase 2: Integration

- [ ] Modify `GGHttp.registerHttpApi()` to call `DirectDiscovery.register()`
- [ ] Modify `GGHttpClient.request()` to check DirectDiscovery first
- [ ] Implement `GGHttpClient.executeDirect()` method
- [ ] Add integration tests

### Phase 3: Authentication

- [ ] Implement auth token decoding in `executeDirect()`
- [ ] Handle `noAuth` routes
- [ ] Support `authStrategy` execution
- [ ] Add auth tests

### Phase 4: Testing & Docs

- [ ] Test with existing test suites (ensure no breakage)
- [ ] Measure performance improvements
- [ ] Update CLAUDE.md with DirectDiscovery info
- [ ] Add usage examples to docs

### Phase 5: Optional Enhancements

- [ ] Add configuration options (if needed)
- [ ] Add metrics/logging for direct calls
- [ ] Add development mode warnings if accidentally using HTTP
- [ ] Performance benchmarks

---

## Migration Path

### Existing Code

**No changes required!** DirectDiscovery works automatically.

```typescript
// This code works unchanged
const client = new ChecklistApiClient(auth, {});
const result = await client.add({ title: "Test" });

// Before: HTTP call
// After: Direct call if in same process, HTTP if not
```

### Opting Out (if needed)

If DirectDiscovery causes issues, can disable per-API:

```typescript
// Option 1: Don't register with DirectDiscovery
DirectDiscovery.unregister("ProblematicApi");

// Option 2: Force HTTP by clearing registry
DirectDiscovery.clear();

// Option 3: Modify GGHttp.registerHttpApi() to skip registration
```

---

## Performance Targets

### Metrics

| Scenario | Current (HTTP) | Target (Direct) | Improvement |
|----------|----------------|-----------------|-------------|
| Single API call overhead | 5-20ms | <0.1ms | 50-200x |
| 100 API calls | 500-2000ms | 5-50ms | 10-100x |
| Test suite (500 calls) | 2.5-10s | 0.5-1s | 5-10x |
| Full test suite (5000 calls) | 25-100s | 5-15s | 5-7x |

### Monitoring

Add optional logging to track usage:

```typescript
public static getHandler(...): DirectHandler | undefined {
    const result = /* lookup logic */;

    if (process.env.DEBUG_DIRECT_DISCOVERY === 'true') {
        if (result) {
            console.log(`DirectDiscovery: HIT - ${apiName} ${method} ${path}`);
        } else {
            console.log(`DirectDiscovery: MISS - ${apiName} ${method} ${path}`);
        }
    }

    return result;
}
```

---

## Security Considerations

### Auth Handling

**Critical:** Must replicate HTTP auth exactly

- ✅ Token decoding matches server
- ✅ User validation identical
- ✅ Auth strategy execution preserved
- ✅ `noAuth` routes respected

**Risk:** If auth differs between direct/HTTP, security hole

**Mitigation:** Extract auth logic to shared function, use in both paths

### Input Validation

**Status:** Already handled by `GGSecureRequestHandler` wrapper

Direct calls go through same validation as HTTP calls.

### Output Validation

**Status:** Already handled by `GGSecureRequestHandler` wrapper

Responses validated regardless of transport.

### Token Exposure

**Risk:** Direct calls bypass HTTPS, token visible in memory

**Reality:** Same risk as HTTP in-process - token already in memory

**Conclusion:** No additional risk

---

## Future Enhancements

### Phase 2 Features (Post-MVP)

1. **Performance Metrics**
   - Track direct vs HTTP call ratio
   - Measure time saved
   - Dashboard showing optimization impact

2. **Smart Fallback**
   - Retry HTTP if direct call fails unexpectedly
   - Circuit breaker pattern

3. **Selective Registration**
   - Per-API opt-in/opt-out
   - Configuration-based control

4. **Cross-Runtime Calls**
   - Detect when services in same process but different runtimes
   - Bridge between runtimes (advanced)

5. **Zero-Copy Mode**
   - Skip object cloning for trusted calls
   - Pass objects by reference (risky but fast)

6. **Development Warnings**
   - Warn if direct call available but HTTP used
   - Help identify configuration issues

---

## Success Criteria

### Must Have (MVP)

- ✅ Direct calls work for registered APIs
- ✅ HTTP fallback works for unregistered APIs
- ✅ Auth works correctly for both paths
- ✅ Validation works correctly for both paths
- ✅ No breaking changes to existing code
- ✅ Test suite runs 2x+ faster

### Should Have

- ✅ Production-ready (can use in real deployments)
- ✅ Easy debugging (clear error messages)
- ✅ Simple to disable if needed
- ✅ Comprehensive tests

### Nice to Have

- Performance metrics
- Configuration options
- Development mode helpers
- Extensive documentation

---

## Open Questions

1. **Should DirectDiscovery.register() be automatic or explicit?**
   - Recommendation: Automatic (simpler)

2. **Should we log when direct calls are used?**
   - Recommendation: Optional via DEBUG flag

3. **What if same API registered twice (multiple runtimes in one process)?**
   - Recommendation: Throw error (unsupported scenario)

4. **Should WebSocket APIs support direct calls?**
   - Recommendation: Future enhancement (different pattern)

5. **Performance impact of Map lookup?**
   - Recommendation: Negligible (<0.01ms), test to confirm

---

## Conclusion

DirectDiscovery provides significant performance improvements with minimal implementation complexity. The static singleton pattern is ideal for this use case, and the automatic fallback to HTTP ensures robustness.

**Estimated Implementation Time:** 2-3 days
**Estimated Performance Gain:** 2-3x for typical test suites
**Risk Level:** Low (additive change, clear fallback)

**Recommendation:** Proceed with implementation.
