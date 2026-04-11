# TODO: Typed HTTP Headers + OpenAPI Documentation

## Status: Deferred — waiting on broader codec architecture changes

---

## Problem

`@grest-ts/openapi` cannot document HTTP headers because headers currently have no
typed schema identity. When `.useHeader(contextKey)` is called on a `GGHttpSchemaBuilder`,
it creates a runtime middleware that knows how to parse/encode the header — but by the
time `GGHttpSchema` is constructed, the connection between "header name" and "schema"
is lost. The openapi package only sees opaque `GGHttpTransportMiddleware` objects.

The schema information technically exists: `GGContextKey.getCodec("http")` holds a
`GGCodec` whose from-schema is something like `IsObject({"accept-language": IsString.orUndefined})`.
But this is convention, not contract — the structure is not formally declared.

## Proposed Solution: `GGHttpHeader`

A minimal `GGHttpHeader` type that ties a header name to its schema:

```ts
// in @grest-ts/http
export class GGHttpHeader<T extends string | undefined = string> {
    constructor(
        readonly name: string,        // "Authorization", "accept-language", "x-api-key"
        readonly schema: GGSchema<T>, // IsString, IsString.nonEmpty.docs({...}), etc.
        readonly required: boolean = false
    ) {}
}
```

HTTP headers are always strings on the wire, so `schema` always extends `IsString`.
The schema carries constraints and docs (pattern, example, description, format) that
describe the wire format. The codec handles parsing the string into a typed context value.

### Registration

```ts
// Current (codec only, no schema)
GG_INTL_LOCALE.addCodec("http", HeaderType.codecTo(IsGGIntlLocaleContext, {
    encode: (headers) => parseLocale(headers["accept-language"]),
    decode: (locale) => ({"accept-language": locale.locale ?? locale.language})
}));

// Proposed (codec + explicit header schema)
GG_INTL_LOCALE.addHttpHeaders([
    new GGHttpHeader(
        "accept-language",
        IsString.orUndefined.docs({
            description: "BCP 47 locale preference",
            example: "en-US, en;q=0.9"
        })
    )
]);
GG_INTL_LOCALE.addCodec("http", ...);  // unchanged
```

### `GGHttpSchema` stores headers

```ts
class GGHttpSchema {
    readonly headers: readonly GGHttpHeader[]  // collected from useHeader() calls
}
```

### `@grest-ts/openapi` emits them

Headers would appear as `parameters[in: "header"]` on every operation that uses
the middleware, or optionally as `securitySchemes` for `Authorization`.

## Open Questions

**1. Security scheme vs. plain header**
`Authorization: Bearer <token>` is semantically different from `accept-language` —
OpenAPI models these differently (`securitySchemes` vs `parameters[in:header]`).
Options:
- Add `kind: "header" | "security"` flag on `GGHttpHeader`
- Detect by header name convention (`Authorization` → security)
- Leave security for a separate `GGSecurityScheme` type
- Document everything as `parameters[in:header]` initially (simplest, defer security)

**2. Migration path**
Changing codec registration on `GGContextKey` is a breaking change for existing
`addCodec("http", ...)` callers. Interim option: add optional `addHttpHeaders()`
as a separate documentation-only call without changing the codec API, then unify
in a follow-up.

**3. Shared codec changes**
This is tied to a broader codec architecture change (currently planned). Avoid mixing
the header schema change with unrelated codec work.

## Files to change when implementing

- `packages/http/http/src/schema/GGHttpSchema.ts` — add `headers` field
- `packages/http/http/src/schema/httpSchema.ts` — collect headers from `useHeader()`
- `packages/http/http/src/server/GGHttpSchema.startServer.ts` — pass headers through
- `@grest-ts/context` — `GGContextKey.addHttpHeaders()`
- `packages-libs/openapi/src/toOpenApi.ts` — emit header parameters
- All existing `addCodec("http", ...)` call sites

## Reference

Discussion in PR #6 (cursor/openapi-http-b3d1). The approach was agreed upon but
deferred due to interaction with a broader codec architecture change.
