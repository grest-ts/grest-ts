# API Docs

🚀 <a href="/api-docs-demo/" target="_blank" rel="noopener"><strong>Open the live demo →</strong></a> &nbsp; The native [@grest-ts/api-docs](@pkg/api-docs) UI rendered against a real example service. The fastest way to see what grest-ts can do with your contracts.

grest-ts contracts already carry every piece of information a typical API consumer needs — request/response schemas, brand identities, error shapes, route paths, HTTP verbs, WebSocket interaction patterns, handshake auth headers. Three independent packages turn that information into different surfaces:

| Package | What it produces | Best for | Detailed docs |
|---|---|---|---|
| **@grest-ts/api-docs** | Native React docs UI rendered from contracts directly — brand intersections, typed errors, HTTP + WS in one page, reuse detection | Developers reading their own service docs | [README](@pkg/api-docs) |
| **@grest-ts/openapi** | OpenAPI 3.1 spec + optional Swagger UI | SDK pipelines, Postman, contract tests, the broader OpenAPI ecosystem | [README](@pkg/openapi) |
| **@grest-ts/asyncapi** | AsyncAPI 3.0 spec + optional AsyncAPI Studio | AsyncAPI tooling consumers | [README](@pkg/asyncapi) |

Each package is a peer with no dependencies on the others. Install only what you need:

```bash
npm install @grest-ts/api-docs   # native UI for your own service docs
npm install @grest-ts/openapi    # for OpenAPI export / Swagger UI
npm install @grest-ts/asyncapi   # for AsyncAPI export / Studio
```

Once you have a spec, the entire OpenAPI / AsyncAPI ecosystem is unlocked — `openapi-generator-cli` for any of 50+ language SDKs, Postman, Spectral linting, contract tests. For TypeScript clients you usually don't need this — `MyApi.createClient()` from `@grest-ts/http` already gives you a fully typed client.

---

## At-a-glance: each surface in one snippet

### Native UI (live, alongside your service)

```typescript
import {GGApiDocs} from "@grest-ts/api-docs"

GGApiDocs.register({
    title: "My App",
    docsPath: "/docs",
    groups: {
        "Catalog":  {http: [ItemApi, OrderApi]},
        "Realtime": {ws:   [ChatApiSchema]},
    },
})
// GET /docs → React UI, /docs/api-docs.json → contract document
```

→ Full options, branding, ungrouped shorthand, static-mode `buildApiDocs()`: [@grest-ts/api-docs README](@pkg/api-docs).

### OpenAPI export (for HTTP-only tooling)

```typescript
import {GGOpenApiDocs} from "@grest-ts/openapi"

GGOpenApiDocs.register({
    title: "My API",
    specPath: "/openapi.json",
    docsPath: "/swagger",
})
// GET /openapi.json → spec, GET /swagger → Swagger UI
```

→ Spec export to file (`toOpenApi()`), multi-spec switcher, Redoc/Scalar via `customUi`, full schema-mapping table: [@grest-ts/openapi README](@pkg/openapi).

### AsyncAPI export (for WS-only tooling)

```typescript
import {GGAsyncApiDocs} from "@grest-ts/asyncapi"

GGAsyncApiDocs.register({
    title: "My App Events",
    specPath: "/asyncapi.json",
    docsPath: "/asyncapi-studio",
})
// GET /asyncapi.json → spec, GET /asyncapi-studio → AsyncAPI Studio
```

→ Spec export to file (`toAsyncApi()`), multi-spec switcher, message-pattern emission, auth handling: [@grest-ts/asyncapi README](@pkg/asyncapi).

---

## Multi-service docs

A typical grest-ts deployment runs several services. Three patterns:

### Option A — One combined static UI (recommended for shared `api/` packages)

If your services share contract packages (the starter default), one combined `buildApiDocs` call documents the whole platform:

```typescript
// scripts/build-platform-docs.ts
import {buildApiDocs} from "@grest-ts/api-docs"
import {UserApi}      from "@myorg/users-api"
import {OrderApi}     from "@myorg/orders-api"
import {InventoryApi} from "@myorg/inventory-api"
import {ChatApiSchema} from "@myorg/realtime-api"

await buildApiDocs({
    title: "MyOrg Platform",
    outDir: "./dist/platform-docs",
    groups: {
        "Users":     {http: [UserApi]},
        "Orders":    {http: [OrderApi]},
        "Inventory": {http: [InventoryApi]},
        "Realtime":  {ws:   [ChatApiSchema]},
    },
})
```

One UI, one URL, all contracts. Cross-method reuse detection works across the whole platform automatically.

### Option B — Per-service docs with a small index page

Each service exposes its own `GGApiDocs.register()` (typical service shape). For a shared entry point, a tiny static index page links to each service's `/docs`:

```html
<!DOCTYPE html>
<html><body>
  <h1>MyOrg APIs</h1>
  <ul>
    <li><a href="https://users.api.myorg.com/docs">Users</a></li>
    <li><a href="https://orders.api.myorg.com/docs">Orders</a></li>
    <li><a href="https://inventory.api.myorg.com/docs">Inventory</a></li>
  </ul>
</body></html>
```

Use this when teams must control their own docs and deployment cadence independently.

### Option C — A dedicated docs runtime

If you want one URL but don't want to expose each service's `/docs` directly, run a tiny dedicated runtime that aggregates contracts via `GGApiDocs.register({groups: {...}})`. Same as Option A but served live instead of statically built.

```typescript
export class DocsRuntime extends GGRuntime {
    public static readonly NAME = "docs"

    protected compose(): void {
        new GGHttpServer()
        GGApiDocs.register({
            title: "MyOrg Platform",
            docsPath: "/",
            groups: {
                "Users":  {http: [UserApi]},
                "Orders": {http: [OrderApi]},
                /* ... */
            },
        })
    }
}
```

### Which to pick

| Situation | Recommended |
|---|---|
| Single team, services in one monorepo, one canonical doc site | **A** — one combined static site |
| Multiple teams, each owning their own service and release cadence | **B** — per-service docs + small index page |
| One URL but no public per-service docs | **C** — dedicated docs runtime |

---

## Tips for great-looking docs

These habits pay off in any of the three surfaces:

- **Use brand types** (`IsEmail`, `IsUrl`, `IsTimestamp`, …) instead of raw `IsString`. The native UI surfaces brand identity as `string & EmailAddress` intersections; without it you just see `string`. Brand identity also drives the **Brands sidebar** and the cross-method reuse popover. OpenAPI/AsyncAPI use the brand name as the schema title.
- **Add `.docs({title, description, example})`** on reusable schemas. In the native UI, examples render as colored tags next to each field and power the auto-generated "Example" body view. In OpenAPI/AsyncAPI they flow into the spec annotations.
- **Always include `SERVER_ERROR`** in every method's `errors` array — and add domain-specific ones with `ERROR.define(...)`. Each error becomes its own response card / spec response.
- **Use `IsBearerToken` (or `.docs({format: "api-key"})`) on auth headers** in middlewares — both the native UI and the spec exporters read these and render an Authentication section / `securitySchemes` entry.
- **Use the same `const`** when the same shape flows through multiple methods (e.g. get/save symmetry). The native UI's reuse detector spots same-instance reuse — `prepareCreate` returning the same `const RowsSchema = IsObject({...})` that `finalizeCreate` accepts as input shows up as an `↔ N` chip in both methods.
