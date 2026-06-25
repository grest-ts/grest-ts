# grest-ts HTTP/WS unification

## Goal

One way to declare and register HTTP, typed-duplex, and raw sockets: object-config
constructors on the real classes (`GGHttpSchema`, `GGWebSocketSchema`,
`GGRawWebSocketSchema`), registered through a single `GGHttp` surface
(`.http` / `.ws` / `.wsRaw`). Delete the fluent builders, `defineSocketContract`,
the per-schema public `.register()` self-registration, and the dead
middleware-context generic.

## Execution model

- **Done in one go**, no per-phase test gate. Phases below are work decomposition for
  sequential subagents; the only green gate is the final verification phase.
- **No backward compatibility on DX.** The old builder/`defineSocketContract`/`.register`
  surface is deleted, not deprecated. Our apps get rewritten to the new format.
- **Flag, don't hack.** If any case forces awkward code or a backward-compat shim,
  stop and report it instead of working around it — we decide one canonical way together.

## Target shape

| Lane | Contract | Schema | Register |
|---|---|---|---|
| HTTP | `GGContractClass` | `new GGHttpSchema({contract, pathPrefix, use?, routes})` | `.http(schema, impl)` |
| Typed socket | `GGDuplexContract` | `new GGWebSocketSchema({contract, path, use?})` | `.ws(schema, handler)` |
| Raw socket | `GGRawSocketContract` | `new GGRawWebSocketSchema({contract, path, use?})` | `.wsRaw(schema, handler)` |

### Contracts

- `GGContractClass(name, methods)` — unchanged (HTTP).
- `GGDuplexContract(name, {connect, clientToServer, serverToClient})` — typed sockets.
  `connect` is a first-class contract method:
  - `connect.errors` — typed, surfaced to the client connect/`createClient` call.
  - `connect.input` — replaces the old `queryOnConnect(validator)`.
  - `connect.permission` — replaces the old `connectPermission(permission)`.
- `GGRawSocketContract(name, {connect, customClient?, protocols?})` — sibling of
  `GGDuplexContract`, shares the `connect` base (documents path/auth/query/connect-errors)
  but has **no** message maps (body is opaque bytes; only `connect` is documented).
  - `customClient: true` → foreign passthrough; `connect` may only use upgrade-readable
    credentials (cookie / `?query=`). Invariants that move into `GGRawWebSocketSchema`
    construction: reject any `use` wire with an `update()` writer; allow a trailing
    wildcard `/*` path only when `customClient`.

### Registration (`GGHttp`)

```ts
new GGHttp(httpServer)
  .use(crossCuttingMw)            // applies to subsequent registrations (eager, order-dependent)
  .http(SomeHttpApi, impl)
  .ws(SomeTypedSocket, handler)
  .wsRaw(SomeRawSocket, rawHandler)
```

- Middleware order at a route: schema `use[]` runs **first**, then `GGHttp.use()` — sequential.
- No `.sub()` (rare scoped-middleware need is covered by a separate `GGHttp` instance).
- The threaded middleware-context generic is removed everywhere — context flows through
  `GGContextKey.get()` (ambient), never through schema/registration generics.

## Phases (sequential subagents)

### Phase 1 — Framework
Build the new construction + registration API and delete the old builder surface in
`packages/`:
- Object-config constructors: `GGHttpSchema`, `GGWebSocketSchema`, new `GGRawWebSocketSchema`.
- `GGDuplexContract.connect` carries `input` + `permission` + `errors`; new `GGRawSocketContract`.
- `GGHttp.http` / `.ws` / `.wsRaw`.
- Remove the middleware-context generic from the touched types.
- Delete `httpSchema()`, `webSocketSchema()`, the builder classes, `defineSocketContract`,
  and the public self-`register()` path (`GGHttp` becomes the only registration entry; an
  internal register mechanism it delegates to is fine).
- Rename leftover `GGDuplexContractClass` → `GGDuplexContract` (already mostly done).

### Phase 2 — Migrate `examples/grest-test`
Convert every API + `main.ts` to the new API:
- Typed sockets → `GGDuplexContract` + `GGWebSocketSchema` + `.ws()`; fold each
  `queryOnConnect`/`connectPermission` into `connect`.
- Raw sockets (`RawEchoApi`, `RawAdminApi`, `CustomClientProxyApi`) → `GGRawSocketContract`
  + `GGRawWebSocketSchema` + `.wsRaw()`.
- Update tests that reference the old API.

### Phase 3 — Migrate satellite example apps
`examples/auth`, `examples/checklist`, `examples/api-docs-v2`, and any remaining
`defineSocketContract` / `httpSchema` / `webSocketSchema` consumer.

### Phase 4 — Verify
Monorepo typecheck + `run_tests { grest-ts }` green. Fix fallout. Grep-verify zero
imports of the deleted surface.
