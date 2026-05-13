<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/api-docs

> **The native documentation UI for grest-ts services.** Renders contracts directly — no conversion to OpenAPI or AsyncAPI in the rendering path. Brand intersection types, typed errors, request/response/event patterns, cross-method reuse detection, all surfaced honestly from your `GGContractClass` definitions.

🚀 <a href="/api-docs-demo/" target="_blank" rel="noopener"><strong>Open the live demo →</strong></a> &nbsp; The actual UI rendered against the [grest-test](https://github.com/grest-ts/grest-ts/tree/master/examples/grest-test) example service. Try the sidebar, brand highlighting, discriminated unions, Schema/Example view toggle.

A typical grest-ts service has both HTTP and WebSocket APIs, with rich types like branded primitives, discriminated unions, and shared response shapes. Generic OpenAPI/AsyncAPI tooling flattens most of that into spec-language. This package renders your contracts as they actually exist — `string & UserId`, `req`/`event` patterns, `IN`/`OUT` for WS direction, "↔ N" reuse chips when the same shape flows through multiple methods.

## Features

- **Native React UI**, served from a single bundle (~70 KB gzipped). Pre-built and shipped with the package — users do not rebuild.
- **Live mode (`GGApiDocs.register`)** mounts the UI + a contract document JSON endpoint on your runtime's HTTP server.
- **Static mode (`buildApiDocs`)** writes the same UI + JSON to a directory — drop on S3 / GitHub Pages / Cloudflare Pages, no rewriting needed.
- **Brand types as `string & BrandName`** intersections — no information lost, the underlying primitive stays visible.
- **HTTP + WebSocket in one page** — `GET /api/users/:id` and `[CLIENT][SENDS TO][SERVER] ws/chat` rendered with the same vocabulary, color-coded distinctions for direction (`IN` indigo / `OUT` orange) and pattern (`req` / `event`).
- **Typed error responses** — every `errors: [VALIDATION_ERROR, ...]` declaration becomes its own response card, with the error data shape rendered alongside.
- **Reuse detection** — when the same `const X = IsObject({...})` (or any branded type) is referenced from multiple methods, an `↔ N` chip surfaces in the schema view. Click → popover lists every other method using it. cmd/ctrl-click opens new tab. Highlight follows you across navigation.
- **Three navigation lenses** — sidebar tabs: **Groups** (your APIs as you composed them), **Brands** (alphabetical brand index), and inline reuse chips (per-schema cross-references).
- **Stable JSON contract document** — the underlying `ApiDocsDocument` format is exported; drives the UI but is also useful for SDK pipelines, AI tooling, or anything that wants a richer view of your contracts than OpenAPI provides.

## Installation

```bash
npm install @grest-ts/api-docs
```

## Live mode — `GGApiDocs.register()`

Drop one call into your runtime's `compose()`. Every distributed system tends to expose more than one API surface (public, admin, internal callbacks) — `docs[]` lets you mount them side-by-side under a single mount path with a header dropdown to switch:

```typescript
import {GGApiDocs} from "@grest-ts/api-docs"
import {GGHttpServer} from "@grest-ts/http"

protected compose(): void {
    new GGHttpServer()

    UserApi.register(new UserApiImpl())
    OrderApi.register(new OrderApiImpl())
    ChatApiSchema.register(new ChatHandler())

    GGApiDocs.register({
        docsPath: "/docs",
        docs: [
            {
                slug: "platform",
                title: "MyOrg Platform",
                version: "1.0.0",
                groups: {
                    "Users":    {http: [UserApi]},
                    "Orders":   {http: [OrderApi]},
                    "Realtime": {ws:   [ChatApiSchema]},
                },
            },
            {
                slug: "internal",
                title: "Internal Callbacks",
                groups: {
                    "Webhooks": {http: [WebhookApi]},
                },
            },
        ],
    })
}
```

Routes mounted under `docsPath`:

| URL                                | Purpose                                                                  |
|------------------------------------|--------------------------------------------------------------------------|
| `GET /docs`                        | React UI shell (HTML), with the doc-switcher dropdown                    |
| `GET /docs/<slug>/api-docs.json`   | The contract document for a single doc (lazy build, cached)              |
| `GET /docs/assets/*`               | Pre-built JS/CSS bundle (~70 KB gzipped, served offline)                 |

The first entry in `docs[]` is the default selection. Deep links use the form `#/<slug>/<group>/<contract>/<method>` — paste any one of those into the URL bar and the dropdown follows.

### Single doc

The same call with one entry — no dropdown is rendered:

```typescript
GGApiDocs.register({
    docsPath: "/docs",
    docs: [{slug: "api", title: "My App", http: [ItemApi, OrderApi], ws: [ChatApiSchema]}],
})
// One "API" group with the schemas split by HTTP / WebSocket; no dropdown.
```

### Ungrouped shorthand

Each `ApiDocSpec` accepts top-level `http`/`ws` arrays as a shortcut for a single auto-named "API" group, just like a `groups` map with one entry:

```typescript
GGApiDocs.register({
    docsPath: "/docs",
    docs: [{slug: "api", title: "My App", http: [ItemApi, OrderApi], ws: [ChatApiSchema]}],
})
```

### Branding

Light visual customization shared across all docs:

```typescript
GGApiDocs.register({
    docsPath: "/docs",
    branding: {
        logoUrl: "/static/logo.svg",
        primaryColor: "#1d4ed8",
    },
    docs: [{slug: "platform", title: "MyOrg Platform", groups: { /* ... */ }}],
})
```

## Static mode — `buildApiDocs()`

Build a complete static site to disk — no runtime required. Same `docs[]` shape as the live mode:

```typescript
import {buildApiDocs} from "@grest-ts/api-docs"

await buildApiDocs({
    outDir: "./dist/docs",
    docs: [
        {
            slug: "platform",
            title: "MyOrg Platform",
            groups: {
                "Users":    {http: [UserApi]},
                "Orders":   {http: [OrderApi]},
                "Realtime": {ws:   [ChatApiSchema]},
            },
        },
    ],
})
```

Output:

```
dist/docs/
├── index.html              ← shell, references ./assets/* + ./<slug>/api-docs.json (relative)
├── platform/
│   └── api-docs.json
└── assets/
    └── index-[hash].{js,css}
```

The shell uses **relative URLs**, so the directory drops onto any static host at any path prefix without rewriting.

## API reference

```typescript
GGApiDocs.register(options: GGApiDocsOptions): void
new GGApiDocs(server: GGHttpServer, options: GGApiDocsOptions)

await buildApiDocs(options: BuildApiDocsOptions): Promise<void>

// Lower-level: just the contract document, no UI — useful for SDK pipelines or custom renderers
buildContractDoc(options: BuildContractDocOptions): ApiDocsDocument
```

See `index-node.ts` for the full type surface.

## When NOT to use this package

- **You specifically need OpenAPI tooling** (Postman, openapi-generator, contract testing) — install [`@grest-ts/openapi`](@pkg/openapi) instead (or alongside).
- **You specifically need AsyncAPI tooling** — install [`@grest-ts/asyncapi`](@pkg/asyncapi).
- **You want vanilla Swagger UI / AsyncAPI Studio** for some other reason — those ship with the openapi/asyncapi packages respectively.

If you want a polished docs UI for your grest-ts service that surfaces what your contracts actually contain, this is the right package.
