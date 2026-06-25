<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/asyncapi

> **Optional package** — generates AsyncAPI 3.0 specs from your grest-ts WebSocket schemas and serves AsyncAPI Studio (the standard interactive viewer).

## Features

- **`toAsyncApi()`** — pure function, no side effects; safe in CI/build scripts for static spec export
- **`GGAsyncApiDocs`** — serves `GET /asyncapi.json` and `GET /asyncapi-docs` (AsyncAPI Studio); schemas auto-collected from the server
- **All four message patterns covered** — request/response, fire-and-forget, server push, and server-initiated request/response
- **Bearer / API-key handshake auth** — middleware headers with `format: "bearer"` or `format: "api-key"` become AsyncAPI `securitySchemes` automatically
- **Named schemas** — every `.docs({title})` schema is extracted to `components/schemas` and reused via `$ref` across messages
- **Symmetric error reporting** — every `errors:[…]` entry becomes its own typed reply message so the spec lists every possible response shape
- **Same `.docs()` passthrough as @grest-ts/openapi** — title, description, example, examples, deprecated all flow into the spec

## Installation

```bash
npm install @grest-ts/asyncapi
```

The package depends on `@grest-ts/openapi` for the schema converter, so you do not need to install both manually if you only want AsyncAPI — `npm install @grest-ts/asyncapi` brings everything.

## Usage

### Serve docs alongside your WebSocket APIs

`GGAsyncApiDocs.register()` mirrors the `MyApi.register()` pattern — pass `http` explicitly, or omit it to use the default `GGHttpServer` from the locator.

```typescript
import {GGAsyncApiDocs} from "@grest-ts/asyncapi";
import {GGHttpServer} from "@grest-ts/http";
import {ChatApi, NotificationApi} from "@myapp/api";

const server = new GGHttpServer();
ChatApi.register(chatHandler);
NotificationApi.register(notificationHandler);

GGAsyncApiDocs.register({
    http: server,                   // optional — falls back to locator default
    title: "My WebSocket APIs",
    version: "1.0.0",
    description: "Chat and notification events",
    specPath: "/asyncapi.json",
    docsPath: "/asyncapi-docs"
});
// GET /asyncapi.json   → AsyncAPI 3.0 spec
// GET /asyncapi-docs   → AsyncAPI Studio (sidebar deep links via /asyncapi-docs/* are also handled)
```

### Explicit schema list

When you want to document schemas that are not registered on this server (e.g. a docs-only build, or sharing a common bundle), pass them in directly:

```typescript
GGAsyncApiDocs.register({
    http: server,
    schemas: [ChatApiSchema, NotificationApiSchema],
    title: "WebSocket Showcase",
    specPath: "/asyncapi.json",
    docsPath: "/asyncapi-docs",
    eager: true   // build spec at construction time (default: lazy on first request)
});
```

### Export spec to a file (CI/scripts)

```typescript
import {toAsyncApi} from "@grest-ts/asyncapi";
import {writeFileSync} from "fs";

const spec = toAsyncApi([ChatApiSchema, NotificationApiSchema], {
    title: "My WebSocket APIs",
    version: "2.0.0",
    servers: {
        production: {host: "api.example.com", protocol: "wss"}
    }
});
writeFileSync("asyncapi.json", JSON.stringify(spec, null, 2));
```

### Multi-spec switcher (`registerGroups`)

When one service exposes WebSocket APIs that consumers want to browse separately, register them as named groups. The studio is rendered with a small custom dropdown above it; switching the dropdown re-renders the studio with the chosen spec.

```typescript
GGAsyncApiDocs.registerGroups({
    groups: {
        "Chat":          [ChatApiSchema],
        "Notifications": [NotificationApiSchema],
    },
    title: "MyOrg Events",
    specPathPrefix: "/asyncapi",
    docsPath: "/asyncapi-docs",
    primary: "Chat",
})
```

Group names get kebab-cased into URL slugs. Because the AsyncAPI react-component does not have a native multi-spec switcher, the dropdown is rendered inside the page template (no public API around it).

For mixed HTTP + WebSocket setups, see [`@grest-ts/api-docs`](@pkg/api-docs) — it builds a unified shell that handles both protocols in one page.

## Message patterns

`@grest-ts/websocket` contracts can describe four interaction patterns; `toAsyncApi()` emits each one with the right `action` / `reply` shape:

| Contract shape | AsyncAPI emission |
|---|---|
| `clientToServer` with `success` and/or `errors` | `action: send` + `reply` listing success and each error message |
| `clientToServer` with no `success` and no `errors` | `action: send` (fire-and-forget; no reply block) |
| `serverToClient` with `input` only | `action: receive` (server push; no reply block) |
| `serverToClient` with `success`/`errors` | `action: receive` + `reply` (server-initiated request/response) |

Every message gets a stable id (`<ChannelName>_<methodName>[_request|_response|_error_<TYPE>]`) so spec consumers can deep-link to a particular interaction.

## Auth

When a WebSocket schema uses a middleware whose header schema declares `.docs({format: "bearer"})` (or `"api-key"`), the converter:

1. Adds the corresponding entry to `components.securitySchemes` (using the header's `.docs({title})` if you provided one — defaults to `BearerAuth` / `ApiKeyAuth`).
2. Attaches a security requirement to every operation on that channel.

```typescript
import {IsBearerToken} from "@grest-ts/schema";

export const ChatAuth = {
    headers: {
        "authorization": IsBearerToken.docs({description: "JWT access token for the chat channel"})
    }
};

export const ChatApiSchema = new GGWebSocketSchema({
    contract: ChatContract,
    path: "ws/chat",
    use: [ChatAuth],
});
```

Plain (non-security) handshake headers are emitted under the channel's `bindings.ws.headers` schema instead.

## Schema → JSON Schema mapping

The schema converter is shared with `@grest-ts/openapi` — the same `.docs({title, description, example, examples, deprecated})` annotations and `.default(value)` values flow into both specs. See the [@grest-ts/openapi mapping table](@pkg/openapi#schema-json-schema-mapping) for the full list.

A handful of post-processing steps adapt the output to AsyncAPI 3.0 conventions: `discriminator: {propertyName: "x"}` collapses to the plain string `"x"`, and `additionalProperties: false` is stripped from message payloads since it adds noise without value in documentation.
