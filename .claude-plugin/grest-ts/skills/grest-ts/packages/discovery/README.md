<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/discovery

Base package for service discovery in grest-ts. Provides the abstract class, types, and locator key that all discovery implementations build on.

For a full overview of how discovery works and available implementations, see the [Discovery guide](@guide/discovery).

## Exports

### `GGDiscoveryClient` (abstract class)

The base class all discovery implementations extend:

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
| `register()` | Registers the service with the discovery backend. |
| `unregister()` | Cleans up on shutdown. |
| `discoverApi()` | Returns the full URL for a given API name. This is what clients call. |

The `isLocal` flag indicates local development mode. When `true`, cloud resources (AWS SNS, etc.) should use local adapters instead.

### `GG_DISCOVERY` (locator key)

```typescript
const GG_DISCOVERY = new GGLocatorKey<GGDiscoveryClient>("GGDiscovery");
```

Service locator key for registering and accessing the active discovery client.

### `GGServiceRegistration` (interface)

```typescript
interface GGServiceRegistration {
    runtime: string;       // Service name
    api: string;           // API name, e.g. "UserApi"
    protocol: "http" | "ws";
    port: number;
    pathPrefix: string;    // e.g. "/api/users/"
}
```

## Implementations

| Package | Use case |
|---|---|
| [`@grest-ts/discovery-static`](@pkg/discovery-static) | Production deployments with known URLs |
| [`@grest-ts/discovery-local`](@pkg/discovery-local) | Local development and testing |
| [`@grest-ts/discovery-kubernetes`](@pkg/discovery-kubernetes) | Kubernetes deployments |
| [`@grest-ts/discovery-migration`](@pkg/discovery-migration) | Zero-downtime migration between strategies |
