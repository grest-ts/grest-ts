<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/api-docs

> **Optional package** — unified HTTP + WebSocket API documentation UI for grest-ts. One sidebar, one page, both protocols.

A typical grest-ts service exposes both `httpSchema()` HTTP APIs and `webSocketSchema()` WebSocket APIs. This package gives you a single doc page that lists them all in one sidebar — Swagger UI renders the OpenAPI panes, AsyncAPI react-component renders the AsyncAPI panes, and a small built-in shell ties them together.

## Features

- **Live mode (`GGApiDocs`)** — register one route prefix, get the unified UI plus standards-compliant spec endpoints (OpenAPI 3.1 / AsyncAPI 3.0)
- **Static mode (`buildApiDocs`)** — write a complete static site to disk for hosting on S3, Cloudflare Pages, GitHub Pages, etc.
- **Mixed HTTP + WebSocket in one page** — the only built-in tool that does this; spec consumers don't have to switch between two URLs
- **User-defined grouping** — organize APIs by team, domain, or any other dimension; sidebar shows groups with HTTP/WS sub-entries
- **Bundled viewers** — Swagger UI and AsyncAPI react-component shipped with the package; works offline; CDN escape hatch via `cdnUrl`
- **`customUi` escape hatch** — replace the shell entirely with your own HTML; the manifest is passed in so you can build any switcher you want around the same standard spec endpoints
- **Stable spec URLs** — `/specs/<group>/openapi.json` and `/specs/<group>/asyncapi.json`; external SDK pipelines / Postman / contract tests work the same way regardless of UI choices

## Installation

```bash
npm install @grest-ts/api-docs
```

This pulls in `@grest-ts/openapi`, `@grest-ts/asyncapi`, and the bundled viewer dependencies.

## Live mode — `GGApiDocs.register()`

Mount the unified UI inside a runtime's `compose()`:

```typescript
import {GGApiDocs} from "@grest-ts/api-docs"
import {GGHttpServer} from "@grest-ts/http"

protected compose(): void {
    new GGHttpServer()

    UserApi.register(new UserApiImpl())
    OrderApi.register(new OrderApiImpl())
    ChatApiSchema.register(new ChatHandler())

    GGApiDocs.register({
        title: "MyOrg Platform",
        version: "1.0.0",
        docsPath: "/docs",
        groups: {
            "Users":  {http: [UserApi], ws: [ChatApiSchema]},
            "Orders": {http: [OrderApi]},
        },
    })
}
```

Routes mounted under `docsPath`:

| Route | Purpose |
|---|---|
| `GET /docs` | Shell HTML |
| `GET /docs/manifest.json` | Sidebar manifest |
| `GET /docs/specs/users/openapi.json` | OpenAPI for the Users group's HTTP APIs |
| `GET /docs/specs/users/asyncapi.json` | AsyncAPI for the Users group's WS APIs |
| `GET /docs/specs/orders/openapi.json` | OpenAPI for the Orders group |
| `GET /docs/assets/*` | Bundled viewer + shell assets |

### Ungrouped shorthand

When you have a small service, skip `groups` entirely:

```typescript
GGApiDocs.register({
    title: "My App",
    docsPath: "/docs",
    http: [ItemApi, OrderApi],
    ws:   [ChatApiSchema],
})
// Sidebar shows one "API" group with the schemas split into HTTP / WebSocket.
```

## Static mode — `buildApiDocs()`

Build a complete static site to disk — no runtime required:

```typescript
import {buildApiDocs} from "@grest-ts/api-docs"

await buildApiDocs({
    title: "MyOrg Platform",
    outDir: "./dist/docs",
    primary: "Users",
    groups: {
        "Users":  {http: [UserApi], ws: [ChatApiSchema]},
        "Orders": {http: [OrderApi]},
    },
})
```

Output:

```
dist/docs/
├── index.html
├── manifest.json
├── specs/
│   ├── users/
│   │   ├── openapi.json
│   │   └── asyncapi.json
│   └── orders/
│       └── openapi.json
└── assets/
    ├── swagger-ui-bundle.js, swagger-ui.css
    ├── asyncapi-component.js, asyncapi-component.css
    └── shell.js, shell.css
```

The shell uses **relative URLs**, so the directory works on any path prefix — drop it on `s3://my-bucket/api-docs/` or `pages.cloudflare.com/myorg/`, no rewriting needed.

The spec JSONs `buildApiDocs()` writes are byte-identical to what live mode serves at the corresponding URLs, so external SDK pipelines work the same way regardless of which mode produced them.

## Branding

Light visual customization without replacing the shell:

```typescript
GGApiDocs.register({
    title: "MyOrg Platform",
    docsPath: "/docs",
    branding: {
        logoUrl: "/static/logo.svg",
        primaryColor: "#1d4ed8",
    },
    groups: { /* ... */ },
})
```

## CDN-loaded viewers

By default the viewers are served from bundled assets (works offline). Switch one or both to a CDN to slim the runtime image:

```typescript
GGApiDocs.register({
    title: "MyOrg",
    docsPath: "/docs",
    cdnUrl: {
        swaggerUi: "https://unpkg.com/swagger-ui-dist@5.32.2",
        asyncApi:  "https://unpkg.com/@asyncapi/react-component@2.5.0",
    },
    groups: { /* ... */ },
})
```

## Custom UI

Replace the shell entirely. The manifest is passed in so you can build a switcher around the same spec endpoints we serve:

```typescript
GGApiDocs.register({
    title: "MyOrg",
    docsPath: "/docs",
    groups: { /* ... */ },
    customUi: (manifest) => `<!DOCTYPE html>
<html><body>
  <h1>${manifest.title}</h1>
  <ul>
    ${manifest.groups.map(g => `<li>${g.name}: ${g.specs.map(s => `<a href="${s.url}">${s.label}</a>`).join(", ")}</li>`).join("")}
  </ul>
</body></html>`,
})
```

When `customUi` is set, no asset routes are registered — the user's HTML is on its own.

## When NOT to use this package

- **HTTP-only or WS-only service** — `GGOpenApiDocs.register()` or `GGAsyncApiDocs.register()` are simpler if you only have one protocol. Use [`@grest-ts/openapi`](@pkg/openapi) / [`@grest-ts/asyncapi`](@pkg/asyncapi) directly.
- **Spec only, no UI** — for SDK generation, contract tests, etc., use `toOpenApi()` / `toAsyncApi()` directly. They have no UI dependencies.
- **You need vanilla Swagger UI** — if you specifically want the standard Swagger UI experience without a custom shell, use `GGOpenApiDocs.register()`.

`@grest-ts/api-docs` is the right choice when (and pretty much only when) you want **mixed HTTP + WebSocket APIs in one page**, which is the typical grest-ts service shape.
