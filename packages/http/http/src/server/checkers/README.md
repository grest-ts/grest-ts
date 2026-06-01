# Startup checkers (QUARANTINED)

These are backend developer-fault / wiring-correctness checks. They catch a wrong `compose()`
(a wire used but never implemented, a route that forgot its `permission`) at startup, before the
server takes traffic. They never fire for a correctly-wired runtime.

Two of them are **temporarily quarantined** here and are *not* wired into `GGHttpServer.start()`.
They were the only consumers of a pile of check-only state and timing that had leaked into the
hot wire/middleware core:

- `isSmart` on `GGWireContextKey` (a flag that only existed to let `_wireSurfaces()` filter wires),
- `_markResolverWired()` / `_schemasWithResolver` (a side-set populated *during* wiring just so
  `_checkPermissionsAtStart()` could later ask "did this schema get a resolver?"),
- `_wireSurfaces()` (a registration-time projection built only to feed `_checkWiresImplemented()`).

Removing them from the core lets the runtime derive everything lazily at request time with no
registration-ordering dependency. The checks are preserved here, self-contained, ready to be
re-armed once the start path supports them cleanly.

## Intended future shape — "2-tick start"

- **Tick 1** — wire everything (`compose()` runs, all `.http()` / `.startServer()` register, all
  resolvers compose). No checks touch the model.
- **Tick 2** — run these checkers over the fully-assembled graph. Because they read a frozen,
  complete graph, they never force eager/registration-time work and never touch the hot model.

When restored, each checker takes explicit inputs derived in that post-compose pass:

- `checkWiresImplemented(httpSchemas, webSocketSchemas)` — already self-contained; it reads each
  schema's middleware list and uses `wireIsDefined(wire)` (a `FACTORIES.has` probe exported from
  `GGWireContextKey.node`) + `wire.hasHandler()`.
- `checkPermissionsAtStart(httpSchemas, webSocketSchemas)` — self-contained; reads each route's
  declared `permission` and enforces strict-mode coverage (once any route declares a permission,
  every route must). The old "orphaned permission" arm and its `schemasWithResolver` input are gone:
  there is no resolver wiring anymore — scopes come only from the schema's wires, so a permissioned
  route on a wire-less schema simply fails closed at runtime instead of being a startup fault.

## Full check catalog

Every wiring/correctness check in the HTTP + WS layer, with status.

| # | Check | Validates | When | Status |
|---|---|---|---|---|
| 1 | missing wire contract | `GGHttpSchema` has a `contract` before `register()` | registration | KEPT INLINE |
| 2 | missing http server | a `GGHttpServer` is in scope or passed via config (HTTP `register`) | registration | KEPT INLINE |
| 3 | missing wire format / codec | each contract method has a wire-format codec | registration | KEPT INLINE |
| 4 | missing impl method | each contract method has an implementation function | registration | KEPT INLINE |
| 5 | missing contract method schema | each codec method maps to a contract method definition | registration | KEPT INLINE |
| 6 | **`_checkWiresImplemented`** | every `.define()`d + `.use()`d wire has a `.create()`d handler | start() | **QUARANTINED (disabled)** → `checkWiresImplemented.ts` |
| 7 | **`_checkPermissionsAtStart`** | strict-mode coverage: once any route declares a permission, every route must (no undeclared route) | start() | **QUARANTINED (disabled)** → `checkPermissionsAtStart.ts` |
| 8 | wire "used but not implemented" | a wire reaches `process()`/`permissions()` with no handler in scope | per-request | KEPT INLINE (per-request safety net) |
| 9 | `.define()` once | a wire is `.define()`d at most once | registration | KEPT INLINE |
| 10 | `.create()` once | a wire handler is `.create()`d at most once per runtime scope | registration | KEPT INLINE |
| 11 | contract non-public permission errors | a method with a non-public `permission` lists `NOT_AUTHORIZED` + `FORBIDDEN` | contract build | KEPT INLINE |
| 12 | `maxBodyBytes` positive int | body-limit config is a positive integer | registration | KEPT INLINE |
| 13 | permission tree shape / depth ≤ 3 | a permission tree is well-formed and at most 3 levels deep | contract build | KEPT INLINE |
| 14 | WS duplicate path | no two WS schemas share the same path | registration | KEPT INLINE |
| 15 | cookie-name safety | a cookie name is a safe RFC token | registration | KEPT INLINE |
| 16 | setCookie route-not-declared | a route only sets cookies it declared in its codec | per-request | KEPT INLINE (per-request safety net) |
| 17 | contract missing handler on `implement()` | `implement()` is given a handler for every contract method | registration | KEPT INLINE |
| 18 | `defineClient` once | a wire's client handler is `.defineClient()`d at most once | client build | KEPT INLINE |
| 19 | WS missing contract | a `GGWebSocketSchema` has a `contract` before `startServer()` | registration | KEPT INLINE |
| 20 | WS missing http server | a `GGHttpServer` is in scope or passed via config (WS `startServer`) | registration | KEPT INLINE |

The two QUARANTINED checks are the only ones removed from the live path. Everything else is a cheap
structural/constructor guard left in place; #8 and #16 are per-request safety nets that still run.

## Parked tests

These assert the now-disabled checks and are skipped (`// QUARANTINED: see ...README.md`):

- `examples/grest-test/test/wire-auth.test.ts` — `"a .use()d smart wire with no .create() refuses
  to start"` (`test.skip`). Drives `WireAuthMissingCreateRuntime`.
- `examples/grest-test/test/permissions-startup.test.ts` — entire `"permission startup check"` suite
  (`describe.skip`). Drives the `StartupCheck*Runtime` fixtures.

To restore: re-arm the checkers in the 2-tick start, then flip `test.skip`/`describe.skip` back to
`test`/`describe` (and drop the QUARANTINED comments). The fixture runtimes are left in place.
