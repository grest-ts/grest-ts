# API Docs (OpenAPI & AsyncAPI)

grest-ts contracts already carry every piece of information a typical API spec needs — request/response schemas, error shapes, route paths, HTTP verbs, even handshake headers for WebSockets. Three optional packages turn that information into industry-standard docs:

- **[@grest-ts/api-docs](@pkg/api-docs)** → unified UI for mixed HTTP + WebSocket APIs (recommended for typical grest-ts services)
- **[@grest-ts/openapi](@pkg/openapi)** → OpenAPI 3.1 + Swagger UI for HTTP-only APIs, plus pure spec generation for CI
- **[@grest-ts/asyncapi](@pkg/asyncapi)** → AsyncAPI 3.0 + AsyncAPI Studio for WebSocket-only APIs, plus pure spec generation for CI

Once you have a spec, the entire OpenAPI/AsyncAPI ecosystem is unlocked — generate SDKs for any language with `openapi-generator`, drop the JSON into Postman/Insomnia/Bruno, render with Redoc/Scalar, validate with Spectral, etc.

## Pick your path

| Your situation | Use |
|---|---|
| Mixed HTTP + WebSocket APIs in one service (typical grest-ts) | **`@grest-ts/api-docs`** — unified shell |
| HTTP-only or WS-only service, want a live UI | `GGOpenApiDocs` / `GGAsyncApiDocs` |
| Want grouped browsing within one protocol | `GGOpenApiDocs.registerGroups()` / `GGAsyncApiDocs.registerGroups()` |
| Spec only — for SDK pipelines, contract tests, etc. | `toOpenApi()` / `toAsyncApi()` (pure functions) |
| Want to host docs separately from any runtime | `buildApiDocs()` for unified, or `toOpenApi()`/`toAsyncApi()` to a file |

This guide walks each path, ending with patterns for **multi-service** setups.

```bash
npm install @grest-ts/api-docs    # unified UI for HTTP + WS
npm install @grest-ts/openapi     # HTTP-only or pure spec generation
npm install @grest-ts/asyncapi    # WS-only or pure spec generation
```

`@grest-ts/api-docs` depends on the other two, so you usually only install one of them depending on your use case.

---

## 1. Unified live docs — `@grest-ts/api-docs`

The recommended path for typical grest-ts services that have both HTTP and WebSocket APIs. One sidebar, one page, both protocols.

```typescript
// server/src/AppRuntime.ts
import {GGRuntime} from "@grest-ts/runtime"
import {GGHttpServer} from "@grest-ts/http"
import {GGApiDocs} from "@grest-ts/api-docs"
import {ItemApi} from "@myapp/api/api/ItemApi"
import {OrderApi} from "@myapp/api/api/OrderApi"
import {ChatApiSchema} from "@myapp/api/ws/ChatApi"

export class AppRuntime extends GGRuntime {
    public static readonly NAME = "app"

    protected compose(): void {
        new GGHttpServer()

        ItemApi.register(new ItemApiImpl())
        OrderApi.register(new OrderApiImpl())
        ChatApiSchema.register(new ChatHandler())

        GGApiDocs.register({
            title: "My App",
            version: "1.0.0",
            docsPath: "/docs",
            groups: {
                "Catalog": {http: [ItemApi]},
                "Orders":  {http: [OrderApi]},
                "Realtime": {ws:  [ChatApiSchema]},
            },
        })
    }
}

AppRuntime.cli(import.meta.url).then()
```

Open `/docs` and you get a single page with a sidebar listing all three groups. Each entry loads the appropriate spec into the right pane via the matching embedded viewer (Swagger UI for HTTP, AsyncAPI react-component for WS).

Routes mounted under `docsPath`:

| URL | What it serves |
|---|---|
| `GET /docs` | Shell HTML |
| `GET /docs/manifest.json` | Sidebar manifest |
| `GET /docs/specs/catalog/openapi.json` | Standards-compliant OpenAPI 3.1 |
| `GET /docs/specs/realtime/asyncapi.json` | Standards-compliant AsyncAPI 3.0 |
| `GET /docs/assets/*` | Bundled viewers + shell assets |

**Spec URLs are stable** — external SDK pipelines, Postman, contract tests can hit them directly without going through the shell. The JSON is the same standards-compliant output that `toOpenApi()` / `toAsyncApi()` produce; the shell is just the UI on top.

### Ungrouped shorthand

When you have a small service with no obvious grouping, skip `groups` entirely:

```typescript
GGApiDocs.register({
    title: "My App",
    docsPath: "/docs",
    http: [ItemApi, OrderApi],
    ws:   [ChatApiSchema],
})
// Sidebar shows one "API" group with HTTP and WebSocket sub-entries.
```

### Branding and overrides

```typescript
GGApiDocs.register({
    title: "My App",
    docsPath: "/docs",
    branding: {logoUrl: "/static/logo.svg", primaryColor: "#1d4ed8"},
    cdnUrl: {                                  // load viewers from CDN, not bundled
        swaggerUi: "https://unpkg.com/swagger-ui-dist@5.32.2",
    },
    customUi: (manifest) => `…your HTML…`,     // replace shell entirely
    groups: { /* … */ },
})
```

`customUi` receives the manifest and returns the full HTML for `/docs`. Use it when you want a completely custom shell — your HTML can still link to the same `/docs/specs/...` endpoints we serve.

---

## 2. Live docs for a single-protocol service

If your service only exposes HTTP **or** only WebSocket APIs, you don't need the unified shell — the lower-level packages give you a vanilla Swagger UI / AsyncAPI Studio with one line.

### HTTP-only — Swagger UI

```typescript
import {GGOpenApiDocs} from "@grest-ts/openapi"

GGOpenApiDocs.register({
    title: "My API",
    version: "1.0.0",
    specPath: "/openapi.json",
    docsPath: "/docs",
})
// GET /openapi.json → OpenAPI 3.1 spec
// GET /docs         → Swagger UI (assets bundled — works offline)
```

Schemas registered on the same `GGHttpServer` are auto-collected. As you add more `Api.register(...)` calls the spec grows automatically.

### WebSocket-only — AsyncAPI Studio

```typescript
import {GGAsyncApiDocs} from "@grest-ts/asyncapi"

GGAsyncApiDocs.register({
    title: "My App Events",
    version: "1.0.0",
    specPath: "/asyncapi.json",
    docsPath: "/asyncapi-docs",
})
```

### Multi-group switcher within one protocol

When one service exposes APIs that naturally belong in separate buckets (per team, per domain, per area), use `registerGroups()`. Each group becomes its own spec endpoint, with a built-in dropdown switching between them — no handwritten HTML required.

```typescript
GGOpenApiDocs.registerGroups({
    groups: {
        "Users":  [UserApi, ProfileApi],
        "Orders": [OrderApi, CartApi],
    },
    title: "MyOrg",
    specPathPrefix: "/openapi",   // → /openapi/users.json, /openapi/orders.json
    docsPath: "/docs",            // → Swagger UI with the dropdown wired up
    primary: "Users",
    combined: true,               // optional: also serves /openapi/all.json with everything merged
})
```

`GGAsyncApiDocs.registerGroups({...})` works the same way for WebSocket APIs.

---

## 3. Build specs for separate hosting

For SDK generation, doc portals, contract testing, or any case where you don't want the docs shipped with the service runtime, two options:

### Static unified site — `buildApiDocs()`

The `@grest-ts/api-docs` analogue of live mode, but writes a complete static directory to disk:

```typescript
// scripts/build-docs.ts
import {buildApiDocs} from "@grest-ts/api-docs"
import {ItemApi, OrderApi} from "@myapp/api"
import {ChatApiSchema} from "@myapp/api/ws"

await buildApiDocs({
    title: "My App",
    outDir: "./dist/docs",
    version: process.env.npm_package_version,
    groups: {
        "Catalog":  {http: [ItemApi]},
        "Orders":   {http: [OrderApi]},
        "Realtime": {ws:  [ChatApiSchema]},
    },
})
```

Output:

```
dist/docs/
├── index.html              ← shell, all paths relative
├── manifest.json
├── specs/<group>/{openapi,asyncapi}.json
└── assets/                 ← bundled viewers + shell assets
```

Drop `dist/docs/` on S3 / Cloudflare Pages / GitHub Pages — the shell uses relative URLs so it works at any path prefix.

### Pure spec only — `toOpenApi()` / `toAsyncApi()`

When you don't need a UI at all (SDK pipelines, Postman collections, contract tests), the pure functions return JSON-serializable spec objects:

```typescript
import {toOpenApi} from "@grest-ts/openapi"
import {writeFileSync} from "fs"

const spec = toOpenApi([ItemApi, OrderApi], {
    title: "My API",
    version: process.env.npm_package_version,
    servers: [{url: "https://api.example.com"}],
})
writeFileSync("dist/openapi.json", JSON.stringify(spec, null, 2))
```

Same shape for `toAsyncApi(schemas, options)`.

### What you get for free downstream

Once you have the JSON, the OpenAPI / AsyncAPI ecosystem takes over:

```bash
# Generate a typed client for any of 50+ languages
openapi-generator-cli generate -i dist/openapi.json -g typescript-fetch -o sdk/

# Static HTML docs site via Redoc
npx redoc-cli build dist/openapi.json -o dist/docs.html

# Lint the spec in CI
npx @stoplight/spectral-cli lint dist/openapi.json
```

For TypeScript clients you usually do not need this — `MyApi.createClient()` from `@grest-ts/http` already gives you a fully typed client. The exported spec is mainly for non-TypeScript consumers and external integrators.

---

## 4. Multi-service docs

A typical grest-ts deployment runs several services, each with its own runtime. Three reasonable patterns for documenting them as a group — pick the one that matches how your consumers want to browse.

### Option A — One combined site, built from shared `api/` packages (recommended)

If your services share common `api/` packages (the default in the starter), produce one combined static site by importing every contract:

```typescript
// scripts/build-platform-docs.ts
import {buildApiDocs} from "@grest-ts/api-docs"
import {UserApi}      from "@myorg/users-api"
import {OrderApi}     from "@myorg/orders-api"
import {InventoryApi} from "@myorg/inventory-api"
import {ChatApiSchema, NotificationApiSchema} from "@myorg/realtime-api"

await buildApiDocs({
    title: "MyOrg Platform",
    outDir: "./dist/platform-docs",
    version: process.env.npm_package_version,
    groups: {
        "Users":     {http: [UserApi]},
        "Orders":    {http: [OrderApi]},
        "Inventory": {http: [InventoryApi]},
        "Realtime":  {ws:   [ChatApiSchema, NotificationApiSchema]},
    },
})
```

Run in CI, ship the directory to your docs host. Most common setup because:

- Build runs against contract-only packages — no runtime, no databases, no env vars.
- Consumers see a single index for the whole platform, HTTP and WS together.
- One SDK build produces one client that talks to every service.

### Option B — Per-service docs that consumers can still browse together

Each runtime serves its own `GGApiDocs` (typical service shape). For a unified entry point, host a small switcher page that points at each service's `/docs` URL:

```html
<!-- docs-hub/index.html — small static page hosted somewhere central -->
<!DOCTYPE html>
<html>
<head><title>MyOrg APIs</title></head>
<body>
  <h1>MyOrg APIs</h1>
  <ul>
    <li><a href="https://users.api.myorg.com/docs">Users</a></li>
    <li><a href="https://orders.api.myorg.com/docs">Orders</a></li>
    <li><a href="https://inventory.api.myorg.com/docs">Inventory</a></li>
    <li><a href="https://realtime.api.myorg.com/docs">Realtime</a></li>
  </ul>
</body>
</html>
```

Use this when teams must control their own docs (and deployment cadence, and visibility) independently. Each `/docs` page is itself a unified `GGApiDocs` shell, so users still get HTTP + WS in one view per service.

### Option C — A dedicated docs runtime

If you want one hosted URL but don't want to expose each service's `/docs` directly, run a tiny dedicated runtime that aggregates schemas via `GGApiDocs.register({groups: {...}})`. Same shape as Option A, just served live instead of built into a static file:

```typescript
// services/docs/src/DocsRuntime.ts
import {GGRuntime} from "@grest-ts/runtime"
import {GGHttpServer} from "@grest-ts/http"
import {GGApiDocs} from "@grest-ts/api-docs"
import {UserApi, OrderApi, InventoryApi} from "@myorg/platform-api"
import {ChatApiSchema} from "@myorg/realtime-api"

export class DocsRuntime extends GGRuntime {
    public static readonly NAME = "docs"

    protected compose(): void {
        new GGHttpServer()

        GGApiDocs.register({
            title: "MyOrg Platform",
            version: "1.0.0",
            docsPath: "/",
            groups: {
                "Users":     {http: [UserApi]},
                "Orders":    {http: [OrderApi]},
                "Inventory": {http: [InventoryApi]},
                "Realtime":  {ws:   [ChatApiSchema]},
            },
        })
    }
}

DocsRuntime.cli(import.meta.url).then()
```

Useful when you want auth around the docs page, or to co-host with other internal tools.

### Which option to pick?

| Situation | Recommended |
|---|---|
| Single team, services in one monorepo, want one canonical doc site | **A** — one combined static site |
| Multiple teams, each owning their own service and release cadence | **B** — per-service docs + small index page |
| You want one URL but no public per-service docs | **C** — dedicated docs runtime |

You can mix them — most platforms end up with B for human browsing and A for the canonical machine-readable artifacts in CI.

---

## Tips for great-looking specs

A few small habits make the generated docs much more useful:

- **Add `.docs({title, description, example})`** to reusable schemas. Anything with a `title` is hoisted into `components/schemas` and reused via `$ref`, which both shrinks the spec and makes generated SDK type names readable.
- **Use branded types** (`IsEmail`, `IsUrl`, `IsTimestamp`, …) instead of raw `IsString`. They carry `format` annotations consumers know how to use.
- **Always include `SERVER_ERROR`** in every method's `errors` array — otherwise consumers won't know to handle 500 responses. Add domain-specific errors with `ERROR.define(...)` and the spec advertises them.
- **Use `IsBearerToken` (or `.docs({format: "api-key"})`) on auth headers** in middlewares. Both packages turn those into `securitySchemes` automatically — Swagger UI shows the "Authorize" button, AsyncAPI Studio shows the lock icon.
- **Build the spec in CI** even if you also serve it live. A diff on the generated JSON is a useful signal for any PR that changes a contract.
- **Use `GGApiDocs` once you add WebSocket APIs**. The single-protocol packages stay useful, but the unified shell is the only built-in way to render mixed HTTP + WS in one page.
