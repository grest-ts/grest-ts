# TODO: @grest-ts/openapi — Architectural Issues

## ✅ Issue 1 — RESOLVED
`enrichWithRefs` deleted. `buildRpcSuccessResponses` now accepts a mandatory
`resolver` parameter. Codecs own their full wire format including $ref.

## ✅ Issue 2 — RESOLVED (partially)
`buildSchemaObject` deleted. `SchemaRegistry.buildFromDesc()` walks `GGSchemaDescription`
nodes directly (no `toCompilerDef()` coupling). The `default:` fallback calls
`schemaDescriptionToOpenApi(desc)` — any new `GGSchemaNodeKind` variant added to the
schema library must also be added to that function.

## ✅ Issue 3 — RESOLVED
`SchemaRegistry` comment updated. Components are extracted when the canonical
schema (via `_base`) has a `docs.title`. The `seen` map is gone.

## ✅ Issue 4 — RESOLVED
`_base` is still public (TypeScript doesn't enforce write-once), but it is never
written externally. The canonical type is now exposed via `GGSchemaDescription.canonical`
— the preferred access path. Accepting the public field with the leading underscore
convention as sufficient.
