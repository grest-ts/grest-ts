# TODO: @grest-ts/asyncapi — AsyncAPI 3.0 spec generation for WebSocket APIs

## Status: Planned

---

## Problem

grest-ts has a full WebSocket API system (`@grest-ts/websocket`) with typed contracts, but
no documentation layer. `@grest-ts/openapi` only covers HTTP — WebSocket APIs are invisible
to API consumers. AsyncAPI 3.0 is the standard for documenting event-driven / message APIs
including WebSockets.

---

## grest-ts WebSocket model recap

A `GGWebSocketSchema` has:
- `name: string` — API name (e.g. "ConfigTestSocketApi")
- `path: string` — WebSocket URL path (e.g. "ws/config-test")
- `contract.clientToServer: GGContractClass` — methods the client can call on the server
- `contract.serverToClient: GGContractClass` — methods the server can push to the client
- `middlewares: GGWebSocketMiddleware[]` — auth/handshake middleware

`GGContractMethod` (for each method):
- `input?: GGSchema` — message payload schema
- `success?: GGSchema` — response schema (present = request/response, absent = fire-and-forget)
- `errors?: ANY_ERROR_CLS[]` — possible error types

Wire format: a custom text protocol `type:path:id:data` where:
- `h` = handshake (client → server, carries headers as JSON)
- `k/x` = handshake ok/error
- `m` = message (fire-and-forget)
- `r` = request (expects response, has id)
- `s` = response (to a request, has id)

---

## Mapping to AsyncAPI 3.0

### Channels

One channel per `GGWebSocketSchema`:

```yaml
channels:
  ws/config-test:
    address: /ws/config-test
    protocol: ws
    title: ConfigTestSocketApi
    bindings:
      ws:
        method: GET
        headers:
          type: object
          properties:
            authorization: ...   # from middlewares[].headers
```

### Messages

Each contract method becomes one or two messages:

| grest-ts | AsyncAPI message |
|---|---|
| `clientToServer.getWatchedValue` (has success) | `getWatchedValue.request` + `getWatchedValue.response` |
| `clientToServer.doSomething` (no success) | `doSomething` (fire-and-forget) |
| `serverToClient.configChanged` | `configChanged` (server push) |

Message payload schema uses `GGSchemaDescription` → same converter as OpenAPI.

Error responses: each error class in `errors[]` maps to an error message variant.

### Operations

```yaml
operations:
  sendGetWatchedValue:
    action: send          # clientToServer → client sends
    channel: ws/config-test
    messages: [getWatchedValue.request]
    reply:
      channel: ws/config-test
      messages: [getWatchedValue.response]
  receiveConfigChanged:
    action: receive       # serverToClient → client receives
    channel: ws/config-test
    messages: [configChanged]
```

### Wire format binding

The custom `type:path:id:data` framing is documented via the ws binding and
a components/schemas entry describing the envelope:

```yaml
components:
  schemas:
    GGSocketEnvelope:
      type: string
      description: "Wire format: <type>:<path>:<id>:<json-data>"
      # e.g. "r:ConfigTestSocketApi.getWatchedValue:req_1:{}"
```

---

## Package structure

```
packages-libs/asyncapi/
  grest.package.ts           # definePackage({name: "@grest-ts/asyncapi", ...})
  src/
    index-node.ts
    toAsyncApi.ts            # toAsyncApi(schemas: GGWebSocketSchema[]): AsyncAPIDocument
    GGAsyncApiServer.ts      # optional: serve GET /asyncapi.json
    schemaDescriptionToJsonSchema.ts  # re-export or re-use from openapi
  test/
    asyncapi.spec.ts
```

**Dependencies:** `@asyncapi/types` (types-only) or define minimal interfaces inline.
Reuses `GGSchemaDescription` + `SchemaRegistry` entirely from `@grest-ts/openapi`,
or alternatively defines its own schema-to-JSON converter (same logic, different import chain).

---

## Open questions

**1. Shared schema converter with openapi?**
`GGSchemaDescription` + `schemaDescriptionToJsonSchema` could be extracted to a shared
neutral package (e.g. `@grest-ts/schema-json`). Both `@grest-ts/openapi` and
`@grest-ts/asyncapi` would depend on it. Avoids duplicating the switch statement.
OR: keep them independent — asyncapi just reimplements the converter for its own types.

**2. How to document the custom wire framing?**
Options:
- Document just the logical message shapes (ignore framing) — simplest, most useful for client devs
- Document the full `type:path:id:data` envelope as a binding annotation — complete but verbose
- Document via a custom bindings section

Recommendation: document logical shapes only. The framing is an implementation detail
that SDK consumers never see — they use `GGSocketClient` which hides it.

**3. Auto-collection of registered schemas**
`GGSocketServer` (like `GGHttpServer`) should gain `registeredSchemas: ReadonlyArray<GGWebSocketSchema>`
populated when `.register()` or `.startServer()` is called. Same pattern as `GGHttpServer._registerSchema()`.
Then `GGAsyncApiServer` can auto-collect, same as `GGOpenApiServer`.

**4. Combined HTTP + WebSocket spec**
Some tooling prefers everything in one document. OpenAPI 3.1 doesn't support WebSockets
natively. AsyncAPI 3.0 can describe both HTTP and WebSocket channels in one document.
Long-term, this might be the goal — one spec covers the whole service. For now, keep them
separate documents.

**5. `GGWebSocketMiddleware.headers` — typed schemas**
Currently `GGWebSocketMiddleware` only has `updateHandshake`/`parseHandshake` with
no typed header declaration. The same upgrade applied to `GGHttpTransportMiddleware`
(changing `headers: string[]` to `headers: Record<string, GGSchema<string | undefined>>`)
should be applied here too. Without it, handshake auth headers won't be documented.
This is a prerequisite for auth documentation in AsyncAPI.

---

## Implementation steps

1. Apply `headers: Record<string, GGSchema>` to `GGWebSocketMiddleware` (prerequisite)
2. Add `registeredSchemas` to `GGSocketServer` (auto-collection)
3. Create `packages-libs/asyncapi/` package scaffold
4. Implement `toAsyncApi(schemas: GGWebSocketSchema[], options): AsyncAPIDocument`
5. Implement `GGAsyncApiServer` (serves `/asyncapi.json`, optional AsyncAPI Studio UI)
6. Tests + snapshot

---

## Complexity: Medium

The schema conversion is free (reuses `GGSchemaDescription`). The main work is mapping
grest-ts's bidirectional contract model to AsyncAPI's channel/operation/message model,
which is well-defined but requires careful reading of the AsyncAPI 3.0 spec.
The custom wire format requires a judgment call (document or abstract away).
Estimated effort: similar to the initial `@grest-ts/openapi` scaffold, smaller than
the full OpenAPI work because the schema conversion layer already exists.
