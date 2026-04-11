<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/openapi

> **Optional package** — generates OpenAPI 3.1 specs from your grest-ts HTTP schemas and serves Swagger UI.

## Features

- **`toOpenApi()`** — pure function, no side effects; safe to use in CI/build scripts for static spec export
- **`GGOpenApiServer`** — serves `GET /openapi.json` and `GET /docs` (CDN-based Swagger UI, zero bundle overhead)
- **`GGHttp.openApi()`** — fluent builder integration via module augmentation
- **Full schema conversion** — all `GGSchema` types → OpenAPI 3.1 / JSON Schema 2020-12
- **Codec-aware** — `GGRpc.*` operations auto-generate path params, query params, and request bodies; `GGFileUpload` produces `multipart/form-data`
- **Error responses** — each `ERROR` class maps to its `STATUS_CODE`; multiple errors at the same code merge as `oneOf`

## Installation

```bash
npm install @grest-ts/openapi
```

## Usage

### Serve docs alongside your API

```typescript
import "@grest-ts/openapi"; // side-effect import augments GGHttp

const server = new GGHttpServer();
const gg = new GGHttp(server)
    .http(ItemApiSchema, itemImpl)
    .openApi([ItemApiSchema], {
        title: "Item API",
        version: "1.0.0",
        description: "Manages items"
    });
// GET /openapi.json → OpenAPI 3.1 spec
// GET /docs         → Swagger UI
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

### Standalone server

```typescript
import {GGOpenApiServer} from "@grest-ts/openapi";

const openApiServer = new GGOpenApiServer([ItemApiSchema], {
    title: "Item API",
    eager: true,       // build spec at construction time instead of first request
    specPath: "/spec", // default: /openapi.json
    docsPath: "/docs"  // default: /docs
});
openApiServer.registerWith(httpServer);
```

## Schema → JSON Schema mapping

| grest-ts type | JSON Schema output |
|---|---|
| `IsString` | `{type:"string"}` + `minLength`, `maxLength`, `pattern` |
| `IsNumber` | `{type:"number"}` + `minimum`, `maximum`, `multipleOf` |
| `IsInt` / `IsUint` / `IsInt8` … | `{type:"integer"}` + appropriate bounds |
| `IsBoolean` | `{type:"boolean"}` |
| `IsBit` | `{type:"integer", minimum:0, maximum:1}` |
| `IsLiteral("a","b")` | `{enum:["a","b"]}` |
| `IsArray(T)` | `{type:"array", items:T}` |
| `IsObject({…})` | `{type:"object", properties:{…}, required:[…]}` |
| `IsRecord(K,V)` | `{type:"object", additionalProperties:V}` |
| `IsUnion(A,B)` | `{oneOf:[A,B]}` |
| `IsDiscriminated(…)` | `{oneOf:[…], discriminator:{propertyName:…}}` |
| `IsTuple(A,B)` | `{type:"array", prefixItems:[A,B], minItems:2, maxItems:2}` |
| `IsAny` / `IsUnknown` | `{}` |
| `.orNull` | wraps in `{oneOf:[schema,{type:"null"}]}` |
| `.docs({…})` | `title`, `description`, `example`, `deprecated` passthrough |

## Custom codec support

Custom `GGHttpCodec` implementations can implement the optional `toOpenApiOperation?` method to override or extend the auto-generated OpenAPI operation:

```typescript
class MyCodec implements GGHttpCodec {
    // …
    toOpenApiOperation(config: GGHttpCodecOpenApiConfig): Partial<OpenAPIV3_1.OperationObject> {
        return {
            security: [{bearerAuth: []}],
            requestBody: {
                content: {"multipart/form-data": {schema: {type: "object"}}}
            }
        };
    }
}
```

