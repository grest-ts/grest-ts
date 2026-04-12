# TODO: @grest-ts/openapi — Architectural Issues

Identified during code review after initial implementation. Fix in a follow-up PR.

---

## Issue 1 — `enrichWithRefs` is a redundant post-processing pass (MOST IMPORTANT)

**File:** `packages-libs/openapi/src/toOpenApi.ts`

`buildOperation()` calls `enrichWithRefs()` to replace the success `data` field
with a `$ref` after the codec has already returned its result. This exists because
`buildRpcSuccessResponses()` lives in `@grest-ts/http` and has no access to the
`SchemaRegistry` — it calls `contract.success.toJSONSchema()` inline.

Problems:
- `enrichWithRefs` hardcodes knowledge of the `{success, type, data}` envelope structure.
  A future codec with a different 200 body would silently miss `$ref` extraction.
- The codec already receives `schemaResolver` — it should handle `$ref` itself in one place.

**Fix:** Add optional `resolver?` parameter to `buildRpcSuccessResponses()`:
```ts
export function buildRpcSuccessResponses(
    contract: GGContractMethod,
    resolver?: GGOpenApiSchemaResolver
): OpenAPIV3_1.ResponsesObject
```
Both `GGRpc.toOpenApiOperation()` and `GGFileUpload.toOpenApiOperation()` pass
`config.schemaResolver`. Then delete `enrichWithRefs()` from `toOpenApi.ts` entirely.

---

## Issue 2 — `buildSchemaObject` duplicates composite schema logic from `toJSONSchema()`

**File:** `packages-libs/openapi/src/SchemaRegistry.ts`

`SchemaRegistry.buildSchemaObject` walks the same composite types (object, array,
union, discriminated, tuple, record) as `GGSchema._buildJsonSchema()`, but calling
`schemaOrRef()` recursively. The logic is structurally duplicated.

If a new schema type is added to `@grest-ts/schema`, both `_buildJsonSchema()` and
`buildSchemaObject` need updating, or `$ref` extraction silently falls back to
`schema.toJSONSchema()` via the `default:` case.

This is an unavoidable consequence of the layering (the registry cannot live in the
schema library), but the `default:` fallback must be explicitly documented as the
escape hatch for any unknown type. Any new composite schema type added to the schema
library must also be added here.

---

## Issue 3 — Stale comment in `SchemaRegistry`

**File:** `packages-libs/openapi/src/SchemaRegistry.ts`, top-level class comment

The comment says:
> A schema is extracted when:
>   1. Its docs.title is set — that becomes the component name.
>   2. It is encountered more than once (same === object identity).

Point 2 is no longer accurate — the `seen` map was removed during the `_base`
refactor. The actual rule is: a schema is extracted when its BASE (via `_base`)
has a `docs.title`. Update the comment to reflect the current logic.

---

## Issue 4 — `_base` is publicly mutable

**File:** `packages/schema/schema/src/GGSchema.ts`

```ts
public _base: GGSchema<any> | undefined = undefined;
```

Nothing prevents external code from overwriting `_base`. It should be effectively
write-once (set in `derive()`, never changed). Options:
- Declare it `readonly`, set via `Object.assign(result, {_base: ...})` in `derive()`
- Add a private setter with a `set once` guard
- Accept the `public` convention (leading underscore as signal) and document it clearly

The real risk is low since external mutation would only affect OpenAPI generation,
not validation. But it's inconsistent with `def` which is frozen.
