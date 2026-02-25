<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# IPC Package (@grest-ts/ipc)

> **Internal package.** This is used by the framework internals (discovery, testkit). You should not need to use it directly in application code.

Type-safe inter-process communication over WebSocket with built-in HTTP routing and proxying. Provides the transport layer for local service discovery and the test framework's runtime communication.

## What it provides

- **IPCServer** - HTTP server with WebSocket support, route interception, and proxy routing
- **IPCClient** - WebSocket client that connects to an IPCServer
- **IPCSocket** - Low-level WebSocket wrapper with request-response messaging and fire-and-forget messages
- **Type-safe request definitions** - Branded string types (`IPCServerRequest`, `IPCClientRequest`) that enforce payload/response types at compile time

## How it is used

### 1. Service Discovery

The discovery package uses IPC for service registration and lookup between runtimes running locally.

**Defining request types:**

```typescript
import {IPCServer} from "@grest-ts/ipc"

export const GGDiscoveryIPC = {
    discoveryServer: {
        register: IPCServer.defineRequest<GGServiceDiscoveryEntry[], void>("discovery/register"),
        discoverApi: IPCServer.defineRequest<string, DiscoverApiResult>("discovery/discoverApi"),
    }
}
```

**Server side** - the discovery server registers handlers on the IPCServer:

```typescript
constructor(server: IPCServer) {
    server.onFrameworkMessage(GGDiscoveryIPC.discoveryServer.register, async (routes) => {
        routes.forEach(route => this.addRoute(route))
    })

    server.onFrameworkMessage(GGDiscoveryIPC.discoveryServer.discoverApi, async (apiName) => {
        const route = this.getRoute(apiName)
        if (route) return {success: true, url: this.server.getUrl()}
        return {success: false, error: "Service not registered"}
    })

    // Route unhandled HTTP/WebSocket traffic to actual services
    server.setRouteProxyResolver((path) => {
        return this.matchRoute(path)?.baseUrl || undefined
    })
}
```

**Client side** - services connect and register themselves:

```typescript
const client = new IPCClient(port)
await client.connect()

// Register routes
await client.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.register, entries)

// Discover another service
const result = await client.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.discoverApi, "my-api")
```

### 2. Test Framework (Runner <-> Worker communication)

The testkit uses IPC for bidirectional communication between the test runner process and runtime worker processes.

**Test runner (server side)** - sends commands to workers and receives registrations:

```typescript
// Runner creates the server
const ipcServer = new IPCServer(port)
await ipcServer.start()

// Handle worker registrations
ipcServer.onFrameworkMessage(TestableIPC.server.registerKeys, async (payload) => {
    runtime.registerLocatorKeys(payload.keys)
})

// Send command to a specific worker by runtimeId
await ipcServer.sendFrameworkMessage(runtimeId, GGConfigIPC.worker.update, {
    storeName: "myStore",
    keyName: "myKey",
    value: newValue
})
```

**Runtime worker (client side)** - connects with a `runtimeId` and handles commands from the runner:

```typescript
const client = new IPCClient(config.testRouterPort)

// runtimeId allows the server to target this specific worker
await client.connect(config.runtimeId)

// Handle commands from test runner
client.onFrameworkRequest(GGConfigIPC.worker.update, async (payload) => {
    await getStore(payload.storeName).updateValueOverride(
        GGConfigKey.getKey(payload.keyName),
        payload.value
    )
})

// Send data back to the runner
await client.sendFrameworkRequest(TestableIPC.server.registerKeys, {
    runtimeId: config.runtimeId,
    keys: runtime.scope.getKeys()
})
```

### 3. HTTP Interception (Test Mocking/Spying)

The HTTP testkit uses the IPCServer's HTTP routing to intercept requests during tests - either mocking responses or spying on traffic while proxying to real services.

**Mock mode** - intercept and return custom responses:

```typescript
// Route discovery traffic for this API to the test server
discoveryServer.addRoute({api: "user-api", baseUrl: server.getUrl(), pathPrefix: "/users"})

// Register a mock handler
server.interceptHttp("GET", "/users/:id", async (body, pathParams) => {
    return {success: true, statusCode: 200, data: {id: pathParams.id, name: "Mock User"}}
})
```

**Spy mode** - observe traffic while forwarding to the real service:

```typescript
server.interceptHttp("POST", "/orders", async (body, _pathParams, headers) => {
    await interceptor.onRequest(body)               // observe the request
    const response = await fetch(targetUrl, {...})   // forward to real service
    await interceptor.onResponse(response)           // observe the response
    return response
})
```

### 4. Leader Election

The resilient discovery client uses IPC's port-binding behavior for leader election. The first instance to successfully start the IPCServer on a known port becomes the leader; others become followers that connect as clients.

```typescript
const server = new IPCServer(knownPort)
if (await server.start()) {
    // Port was available - this instance is the leader
    this.isLeader = true
} else {
    // Port already taken - connect as follower
    await client.connect()
    client.onClose(async () => {
        // Leader died - try to become the new leader
        await this.becomeLeaderOrFollower()
    })
}
```

## Defining Request Types

Requests are defined as branded strings with phantom type parameters for compile-time safety.

```typescript
// For requests sent TO the server (client -> server)
const myRequest = IPCServer.defineRequest<RequestPayload, ResponsePayload>("my/request")

// For requests sent TO the client (server -> client)
const myCommand = IPCClient.defineRequest<CommandPayload, CommandResult>("my/command")
```

## Architecture

```
IPCServer
├── HttpHandler       - Route matching (find-my-way), request handling, HTTP proxying (http-proxy)
├── SocketHandler     - WebSocket upgrade handling, client tracking by clientId/runtimeId, WS proxying
│   └── IPCSocket     - Per-connection message framing, request-response correlation, timeouts
└── http.Server       - Underlying Node.js HTTP server (handles both HTTP and WS upgrade)

IPCClient
└── IPCSocket         - WebSocket connection to server, message/request handlers
```

**Message protocol:** Messages are framed as `type:id:path:data` over WebSocket text frames, where type is `m` (fire-and-forget), `r` (request), or `s` (response). Data is JSON-serialized.
