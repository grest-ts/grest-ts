# Discovery

Discovery is a service discovery mechanism that enables services in grest-ts to find and communicate with each other. It solves the problem of "where is this API?" by abstracting away URL resolution, so application code never hardcodes service locations.

## Core Concept

Every grest-ts HTTP server registers what APIs it provides. Every HTTP client discovers where those APIs are located. The discovery layer sits between them:

```
HTTP Server starts
  -> registerRoutes({ api: "UserApi", port: 8080, pathPrefix: "/api/users/" })

HTTP Client makes a call
  -> discoverApi("UserApi")
  -> returns "http://user-service:8080/api/users/"
  -> client appends method path and makes the request
```

Different deployment environments need different discovery strategies (static URLs, IPC, Kubernetes DNS, etc.), but the application code stays the same.

## Architecture

### Abstract Base: `GGDiscoveryClient`

All discovery implementations extend this class (`@grest-ts/discovery`):

```typescript
abstract class GGDiscoveryClient {
    readonly isLocal: boolean = false;

    abstract registerRoutes(registrations: GGServiceRegistration[]): void;
    abstract register(): Promise<void>;
    abstract unregister(): Promise<void>;
    abstract discoverApi(apiName: string): Promise<string>;
}
```

| Method | Purpose |
|---|---|
| `registerRoutes()` | Called when an HTTP server starts. Tells discovery what APIs this service provides. |
| `register()` | Registers the service with the discovery backend (ConfigMap, IPC server, etc.). |
| `unregister()` | Cleans up on shutdown. |
| `discoverApi()` | Returns the full URL for a given API name. This is what clients call. |

### Data Types

**`GGServiceRegistration`** - what the HTTP server knows about itself:

```typescript
interface GGServiceRegistration {
    runtime: string;           // Service name
    api: string;               // API name, e.g. "UserApi"
    protocol: "http" | "ws";
    port: number;
    pathPrefix: string;        // e.g. "/api/users/"
}
```

**`GGServiceDiscoveryEntry`** - what discovery stores internally and what consumers need:

```typescript
interface GGServiceDiscoveryEntry {
    api: string;
    baseUrl: string;     // e.g. "http://localhost:8080"
    pathPrefix: string;  // e.g. "/api/users/"
}
```

### Integration with HTTP

Registration happens automatically when a server starts:

```typescript
// In GGHttpSchema.startServer.ts
server.onStart(() => {
    GG_DISCOVERY.tryGet()?.registerRoutes([{
        runtime: scope.serviceName,
        api: httpSchema.name,
        pathPrefix: pathPrefix,
        protocol: "http",
        port: server.port
    }]);
});
```

Discovery happens automatically when a client makes a call without an explicit URL:

```typescript
// In GGHttpSchema.createClient.ts
if (baseUrl === undefined) {
    const { GG_DISCOVERY } = await import('@grest-ts/discovery');
    baseUrl = await GG_DISCOVERY.get().discoverApi(httpSchema.name);
}
```

The discovery client is registered in the `GGLocator` service locator with lifecycle management, ensuring it starts before HTTP servers and shuts down cleanly:

```typescript
GGLocator.getScope().setWithLifecycle(GG_DISCOVERY, discoveryInstance, {
    type: GGLocatorServiceType.SERVICE_DISCOVERY,
    start: () => discovery.register(),
    teardown: () => discovery.unregister()
});
```

## Implementations

### Static Discovery (`@grest-ts/discovery-static`)

For deployments with known, fixed URLs (AWS Elastic Beanstalk, Heroku, Railway, Fly.io, etc.).

URLs are configured via environment variables or a config object. No dynamic registration, no discovery infrastructure needed.

**From environment variables:**

```bash
USER_API_URL=https://user-service.elasticbeanstalk.com/api/users/
ORDER_API_URL=https://order-service.us-east-1.elasticbeanstalk.com/api/orders/
```

```typescript
const discovery = new GGStaticServiceDiscovery();
// Reads *_API_URL env vars automatically
// USER_API_URL -> UserApi
// ORDER_API_URL -> OrderApi
```

**From a config object:**

```typescript
const discovery = new GGStaticServiceDiscovery({
    UserApi: 'https://user-service.elasticbeanstalk.com/api/users/',
    OrderApi: 'https://order-service.elasticbeanstalk.com/api/orders/'
});
```

`registerRoutes()` is a no-op since URLs are pre-configured.

### Local Discovery (`@grest-ts/discovery-local`)

For local development and testing. Uses IPC (inter-process communication) over sockets so multiple service instances can discover each other on the same machine.

**Architecture:** A discovery server acts as a central router. Service instances connect as clients, register their routes, and discover other services through the router.

**`GGLocalDiscoveryClient`** - connects to an existing discovery server:

```typescript
const discovery = new GGLocalDiscoveryClient(9000); // Router port
```

On registration, the client tells the router about its APIs. On discovery, the router returns its own URL (it acts as a reverse proxy, forwarding requests to the correct backend).

**`GGLocalDiscoveryResilientClient`** - adds leader election with automatic failover:

```typescript
const discovery = new GGLocalDiscoveryResilientClient(9000);
```

Multiple instances compete for the router port. The first to acquire it becomes the leader and runs the discovery server. Others connect as followers. If the leader dies, a follower takes over and re-registers its routes.

**`GGLocalDiscoveryServer`** - the router itself:

```typescript
const server = new IPCServer(9000);
const router = new GGLocalDiscoveryServer(server);
await router.start();
```

The server maintains a registry of API-to-instance mappings and proxies incoming requests to the correct backend based on path prefix matching.

#### Routing Strategies

When multiple instances of the same API are registered, the router uses a strategy to pick which instance handles each request:

| Strategy | Behavior |
|---|---|
| `roundRobin` (default) | Cycles through instances per unique path |
| `first` | Always uses the first registered instance |
| `last` | Always uses the most recently registered instance |
| `random` | Picks a random instance |

```typescript
router.setRoutingStrategy('UserApi', 'roundRobin');
router.setRoutingStrategy('PaymentApi', new MyCustomStrategy());
```

The `RoutingStrategy` interface:

```typescript
interface RoutingStrategy {
    select(instances: GGServiceDiscoveryEntry[], path: string): GGServiceDiscoveryEntry;
}
```

#### IPC Protocol

Communication between clients and the server uses typed IPC messages:

| Message | Direction | Purpose |
|---|---|---|
| `discovery/register` | Client -> Server | Register API entries |
| `discovery/unregister` | Client -> Server | Remove API entries |
| `discovery/discoverApi` | Client -> Server | Find where an API lives |

#### Testing

The testkit provides `GGLocalRoutingStrategySelector` for controlling routing strategies in tests:

```typescript
const strategySelector = new GGLocalRoutingStrategySelector('UserApi');
strategySelector.first();      // Always route to first instance
strategySelector.roundRobin(); // Cycle through instances
strategySelector.set(new MyStrategy()); // Use custom strategy
```

### Kubernetes Discovery (`@grest-ts/discovery-kubernetes`)

For production deployments on Kubernetes. Uses K8s DNS naming and ConfigMaps for API metadata.

```typescript
const discovery = new GGKubernetesServiceDiscovery({
    serviceName: 'user-service',
    namespace: 'default',
    useShortNames: true,
    configMapName: 'gg-service-discovery'
});
```

**How it works:**

1. `registerRoutes()` builds URLs using Kubernetes DNS conventions:
   - Short form (same namespace): `http://user-service:8080`
   - Full FQDN: `http://user-service.default.svc.cluster.local:8080`
2. `register()` writes API metadata to a shared ConfigMap (`gg-service-discovery`)
3. `discoverApi()` reads the ConfigMap to find the target API's URL
4. `unregister()` removes entries from the ConfigMap

**Environment variables:**

| Variable | Purpose | Default |
|---|---|---|
| `K8S_SERVICE_NAME` | This service's K8s service name | `'unknown-service'` |
| `K8S_NAMESPACE` | Kubernetes namespace | `'default'` |
| `K8S_TOKEN` | Service account token for K8s API | Required |
| `K8S_API_URL` | Kubernetes API server URL | `'https://kubernetes.default.svc'` |

**DNS-only discovery** (no ConfigMap needed):

```typescript
const url = GGKubernetesServiceDiscovery.discoverApiViaDns('user-service', {
    namespace: 'default',
    port: 8080,
    useShortNames: true
});
// -> "http://user-service:8080"
```

**Required RBAC permissions:** read/write access to ConfigMaps in the service's namespace.

### Migration Discovery (`@grest-ts/discovery-migration`)

A wrapper that enables zero-downtime migration between discovery strategies. It registers with **both** old and new systems, and discovers from **one** (configurable).

**Phase 1 - Dual registration, discover from old:**

```typescript
const discovery = new GGMigrationServiceDiscovery({
    old: new GGStaticServiceDiscovery(),
    new: new GGKubernetesServiceDiscovery(),
    discoverFrom: 'old'
});
// Both systems get populated. Old URLs still in use.
```

**Phase 2 - Dual registration, discover from new:**

```typescript
const discovery = new GGMigrationServiceDiscovery({
    old: new GGStaticServiceDiscovery(),
    new: new GGKubernetesServiceDiscovery(),
    discoverFrom: 'new'
});
// Switch to new system. Automatic fallback to old on failure.
```

**Phase 3 - Remove the wrapper:**

```typescript
const discovery = new GGKubernetesServiceDiscovery();
// Migration complete.
```

The `shouldFallback()` method controls automatic fallback behavior and can be overridden:

```typescript
class StrictMigration extends GGMigrationServiceDiscovery {
    protected override shouldFallback(): boolean {
        return false; // No fallback - fail fast to find issues
    }
}
```

## Extending Discovery

### Creating a Custom Implementation

Extend `GGDiscoveryClient` and implement all four abstract methods:

```typescript
import { GGDiscoveryClient, GGServiceRegistration } from "@grest-ts/discovery";

export class ConsulServiceDiscovery extends GGDiscoveryClient {
    private entries: GGServiceDiscoveryEntry[] = [];

    public registerRoutes(registrations: GGServiceRegistration[]): void {
        for (const reg of registrations) {
            this.entries.push({
                api: reg.api,
                baseUrl: `${reg.protocol}://localhost:${reg.port}`,
                pathPrefix: reg.pathPrefix
            });
        }
    }

    public async register(): Promise<void> {
        for (const entry of this.entries) {
            await consul.agent.service.register({
                name: entry.api,
                address: entry.baseUrl,
                meta: { pathPrefix: entry.pathPrefix }
            });
        }
    }

    public async unregister(): Promise<void> {
        for (const entry of this.entries) {
            await consul.agent.service.deregister(entry.api);
        }
    }

    public async discoverApi(apiName: string): Promise<string> {
        const services = await consul.health.service(apiName);
        const instance = services[0];
        return instance.address + instance.meta.pathPrefix;
    }
}
```

### Creating a Custom Routing Strategy

Implement the `RoutingStrategy` interface:

```typescript
import { RoutingStrategy } from "@grest-ts/discovery-local";
import { GGServiceDiscoveryEntry } from "@grest-ts/discovery-local";

export class HashBasedStrategy implements RoutingStrategy {
    select(instances: GGServiceDiscoveryEntry[], path: string): GGServiceDiscoveryEntry {
        // Deterministic routing: same path always goes to same instance
        let hash = 0;
        for (let i = 0; i < path.length; i++) {
            hash = ((hash << 5) - hash) + path.charCodeAt(i);
            hash |= 0;
        }
        return instances[Math.abs(hash) % instances.length];
    }
}
```

### Wrapping an Existing Implementation

Use composition to add cross-cutting concerns (caching, logging, metrics):

```typescript
export class CachingDiscovery extends GGDiscoveryClient {
    private cache = new Map<string, string>();

    constructor(private wrapped: GGDiscoveryClient) {
        super();
    }

    public registerRoutes(registrations: GGServiceRegistration[]): void {
        this.wrapped.registerRoutes(registrations);
    }

    public async register(): Promise<void> {
        await this.wrapped.register();
    }

    public async unregister(): Promise<void> {
        this.cache.clear();
        await this.wrapped.unregister();
    }

    public async discoverApi(apiName: string): Promise<string> {
        const cached = this.cache.get(apiName);
        if (cached) return cached;

        const url = await this.wrapped.discoverApi(apiName);
        this.cache.set(apiName, url);
        return url;
    }
}
```

## Package Organization

| Package | NPM | Purpose |
|---|---|---|
| `@grest-ts/discovery` | Base | `GGDiscoveryClient` abstract class, `GG_DISCOVERY` locator key, types |
| `@grest-ts/discovery-static` | Impl | Static URL configuration for simple cloud deployments |
| `@grest-ts/discovery-local` | Impl | IPC-based discovery for local development and testing |
| `@grest-ts/discovery-kubernetes` | Impl | Kubernetes DNS + ConfigMap-based discovery |
| `@grest-ts/discovery-migration` | Wrapper | Zero-downtime migration between discovery strategies |

## Choosing an Implementation

| Scenario | Implementation |
|---|---|
| Local development | `GGLocalDiscoveryResilientClient` |
| Integration tests | `GGLocalDiscoveryClient` with test router |
| Single cloud deployment (Heroku, Railway, etc.) | `GGStaticServiceDiscovery` |
| Kubernetes | `GGKubernetesServiceDiscovery` |
| Migrating between strategies | `GGMigrationServiceDiscovery` |
| Custom infrastructure | Extend `GGDiscoveryClient` |
