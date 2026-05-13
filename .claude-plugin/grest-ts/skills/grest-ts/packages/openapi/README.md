<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/openapi

> **Optional package** — generates OpenAPI 3.1 specs from your grest-ts HTTP schemas and serves Swagger UI.

## Features

- **`toOpenApi()`** — pure function, no side effects; safe in CI/build scripts for static spec export
- **`GGOpenApiDocs`** — serves `GET /openapi.json` and `GET /docs` (Swagger UI); schemas auto-collected from the server
- **`GGHttp.openApi()`** — fluent builder integration via module augmentation; no schema list to maintain
- **Bundled assets** — Swagger UI served from `swagger-ui-dist` (no CDN dependency, works offline)
- **Full schema conversion** — all `GGSchema` types → OpenAPI 3.1 / JSON Schema 2020-12
- **`.docs()` and `.default()` passthrough** — title, description, example, deprecated, default values flow into the spec automatically
- **Codec-aware** — `GGRpc.*` auto-generates path/query params and request bodies; `GGFileUpload` → `multipart/form-data`; `GGFileDownload` → binary response
- **Error responses** — each `ERROR` class maps to its `STATUS_CODE`; multiple errors at the same code merge as `oneOf`
- **Unique operationIds** — format `ApiName_methodName` (e.g. `ItemApi_list`), globally unique across composed schemas

## Installation

```bash
npm install @grest-ts/openapi
```

## Usage

### Serve docs alongside your API (GGHttp builder)

Import `@grest-ts/openapi` once — it augments `GGHttp` with `.openApi()`. All schemas registered via `.http()` are collected automatically; no list to keep in sync.

```typescript
import "@grest-ts/openapi";
import {GGHttp, GGHttpServer} from "@grest-ts/http";

const server = new GGHttpServer();
new GGHttp(server)
    .http(ItemApiSchema, itemImpl)
    .http(OrderApiSchema, orderImpl)
    .openApi({
        title: "My API",
        version: "1.0.0",
        description: "Item and order management",
        specPath: "/openapi.json",
        docsPath: "/docs"
    });
// GET /openapi.json → OpenAPI 3.1 spec
// GET /docs         → Swagger UI (served from bundled assets)
// GET /docs/assets/swagger-ui-bundle.js  ─┐ served locally,
// GET /docs/assets/swagger-ui.css        ─┘ no CDN required
```

### Standalone (when using schema.register() directly)

```typescript
import {GGOpenApiDocs} from "@grest-ts/openapi";
import {GGHttpServer} from "@grest-ts/http";

const httpServer = new GGHttpServer();
ItemApiSchema.register(itemImpl);
OrderApiSchema.register(orderImpl);

new GGOpenApiDocs(httpServer, {
    title: "My API",
    version: "1.0.0",
    specPath: "/openapi.json",
    docsPath: "/docs",
    eager: true   // build spec at construction time (default: lazy on first request)
})
```

### Export spec to a file (CI/scripts)

```typescript
import {toOpenApi} from "@grest-ts/openapi";
import {writeFileSync} from "fs";

const spec = toOpenApi([ItemApiSchema, OrderApiSchema], {
    title: "My API",
    version: "2.0.0",
    servers: [{url: "https://api.example.com"}]
});
writeFileSync("openapi.json", JSON.stringify(spec, null, 2));
```

### Multi-spec switcher (`registerGroups`)

When one service exposes APIs that consumers want to browse separately — by team, by domain, by area — register them as named groups. Each group becomes its own spec endpoint, and the docs page shows a dropdown that switches between them via Swagger UI's built-in `urls` config.

```typescript
GGOpenApiDocs.registerGroups({
    groups: {
        "Users":  [UserApi, ProfileApi],
        "Orders": [OrderApi, CartApi],
    },
    title: "MyOrg",
    specPathPrefix: "/openapi",   // → /openapi/users.json, /openapi/orders.json
    docsPath: "/docs",            // → one Swagger UI with the dropdown wired up
    primary: "Users",             // optional, defaults to first group
    combined: true,               // optional — also serves /openapi/all.json with everything merged
})
```

Group names get kebab-cased into URL slugs (`Order Management` → `/openapi/order-management.json`). Swagger UI handles the dropdown natively, so the page is the same shape as single-spec mode plus a selector at the top.

For mixed HTTP + WebSocket setups, see [`@grest-ts/api-docs`](@pkg/api-docs) instead — it builds a unified shell that handles both protocols in one page.

### Custom or alternative UI

Use `customUi` to serve Redoc, Scalar, or any other UI instead of Swagger UI:

```typescript
new GGHttp(server)
    .http(ItemApiSchema, itemImpl)
    .openApi({
        title: "My API",
        specPath: "/openapi.json",
        docsPath: "/docs",
        customUi: (specUrl) => `<!DOCTYPE html>
<html><head>
  <script src="https://cdn.jsdelivr.net/npm/redoc/bundles/redoc.standalone.js"></script>
</head><body>
  <redoc spec-url="${specUrl}"></redoc>
</body></html>`
    });
```

Use `cdnUrl` to load Swagger UI from a CDN instead of the bundled assets:

```typescript
.openApi({
    title: "My API",
    specPath: "/openapi.json",
    docsPath: "/docs",
    cdnUrl: "https://unpkg.com/swagger-ui-dist@5.32.2"
})
```

## Schema → JSON Schema mapping

| grest-ts | JSON Schema output |
|---|---|
| `IsString` | `{type:"string"}` + `minLength`, `maxLength`, `pattern` |
| `IsString.nonEmpty` | `{type:"string", minLength:1}` |
| `IsNumber` | `{type:"number"}` + `minimum`, `maximum`, `multipleOf` |
| `IsInt` / `IsUint` / `IsInt8` … | `{type:"integer"}` + appropriate bounds |
| `IsBoolean` | `{type:"boolean"}` |
| `IsBit` | `{type:"integer", minimum:0, maximum:1}` |
| `IsFile` | `{type:"string", format:"binary"}` |
| `IsLiteral("a","b")` | `{enum:["a","b"]}` |
| `IsArray(T)` | `{type:"array", items:T}` + `minItems`, `maxItems` |
| `IsObject({…})` | `{type:"object", properties:{…}, required:[…]}` |
| `IsRecord(K,V)` | `{type:"object", additionalProperties:V}` |
| `IsUnion(A,B)` | `{oneOf:[A,B]}` |
| `IsDiscriminated(…)` | `{oneOf:[…], discriminator:{propertyName:…}}` |
| `IsTuple(A,B)` | `{type:"array", prefixItems:[A,B], minItems:2, maxItems:2}` |
| `IsAny` / `IsUnknown` | `{}` |
| `.orNull` | wraps in `{oneOf:[schema, {type:"null"}]}` |
| `.docs({title, description, example, examples, deprecated})` | applied as JSON Schema annotations |
| `.default(value)` | emitted as `default` |

## Custom codec support

Every codec used in an OpenAPI schema **must** implement `toOpenApiOperation()`. The method must return `responses` — the codec owns its wire format and is responsible for declaring its success response shape. Use `buildRpcSuccessResponses(contract)` if your codec uses the standard `{success, type, data}` JSON envelope.

```typescript
import {buildRpcSuccessResponses, buildOpenApiParameters} from "@grest-ts/http";
import type {OpenAPIV3_1} from "openapi-types";

class MyCodec implements GGHttpCodec {
    readonly method = "POST" as const;
    readonly path: string;

    toOpenApiOperation(config: GGHttpCodecOpenApiConfig): Partial<OpenAPIV3_1.OperationObject> {
        const hasBody = true;
        return {
            parameters: buildOpenApiParameters(this.path, hasBody, config.contract.input),
            requestBody: {
                required: true,
                content: {"application/json": {schema: config.contract.input!.toJSONSchema()}}
            },
            // Required — codec must declare its own success shape
            responses: buildRpcSuccessResponses(config.contract)
        };
    }

    // … createForClient / createForServer
}
```

If `toOpenApiOperation` is missing or returns no `responses`, `toOpenApi()` throws with a descriptive error.
