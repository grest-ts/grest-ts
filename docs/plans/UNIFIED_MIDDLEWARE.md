# Plan: unified wire layer (`GGHeader` / `GGCookie` + context keys)

Status: DESIGN IN PROGRESS (2026-05-31), branch `kratt/middleware-v2`. Replaces the
earlier `WIRE_BINDINGS.md` design entirely — that one treated "auth is not a property of
the wire; bindings are just middlewares." This one is the opposite where it matters:
**smart wires are first-class, required, ephemeral, and must be implemented or the runtime
throws.** Same single-`.use()` ergonomics; stronger guarantees.

Two things drive every decision below:

1. **Secure by design.** The safe path is the only ergonomic path. Credentials cannot
   silently leak into handler code; a wire that's listed must work or the request fails
   loud; "is this endpoint protected?" is a one-bit fact readable off the schema.
2. **Great DX.** One searchable symbol per concept (`grep USER_TOKEN_WIRE` finds every
   site; `ctrl+click` lands on real code). No per-method ceremony for the common case. The
   same mental model on browser and node.

---

## The model in one example

This is the whole thing. Everything after is just the rules this example obeys.

```ts
// API ---------------------------------
// dumb: ONE symbol. It IS the readable key. Persists for the request. No implement.
export const TRACE_ID = new GGContextKey("TRACE_ID", IsString.nonEmpty)        // GGWireContextKey<string>
export const TRACE_ID_WIRE = new GGHeader("x-trace-id", TRACE_ID); // If context key is argument, implement is not needed.

// smart: a wire key that REQUIRES .define(); ephemeral. Produces a separate durable key.
export const USER_TOKEN_WIRE = new GGHeader("authorization", {scheme: "bearer"})

const MySchema = XXXX
    .use(TRACE_ID_WIRE) // If I use this API, it automatically uses TRACE_ID everywhere. Don't need to wire this anywhere else anymore.
    .use(USER_TOKEN_WIRE)

const MySomeOtherSchema = XXXX
    .use(TRACE_ID_WIRE)
    .use(USER_TOKEN_WIRE)

// BACKEND  ---------------------------------
// Somewhere in backend commons.
export const USER_DATA = new GGContextKey("userData", IsAuthUser)   // plain key — the durable result
const UserTokenWireHandler = USER_TOKEN_WIRE.define((users: MyUsersService) => ({ // .define can only be called once, next ones throw hard.
    process: async () => {
        USER_DATA.set(await users.verifyAccessToken(USER_TOKEN_WIRE.get()))
        if (!USER_DATA.get()) throw NOT_AUTHORIZED   // authn fails HERE; authz is the per-method gate
    },
    permissions: async () => {
        return USER_DATA.get().permissions;
    }
}))

// IN Runtime compose
const users = new MyUsersService()
UserTokenWireHandler.create(users) // .create can also be called ONCE per runtime. Links to async context via GGLocator.
                                   // MUST be async-context-bound and NOT stateful (as any normal service would be).

// Simple cases, no reuse — no variable needed
USER_TOKEN_WIRE.define(() => ({ /* ... */ })).create()

new GGHttp().use(USER_TOKEN_WIRE) // NOT NEEDED — the schema already knows. Optional: it just enforces implementation at startup.

// frontend  ---------------------------------
const UserTokenWireHandler = USER_TOKEN_WIRE.defineClient((session) => ({
    value: () => session.get()?.accessToken,
    isStale: () => {
        const s = session.get();
        return !!s && jwtExpired(s.accessToken)
    },
    recover: async () => session.set(await auth.refresh({refreshToken: session.get()!.refreshToken})),
}))
UserTokenWireHandler.create(session);  // once. `session` MUST be an async-context store, not a captured object (see Security §1).

// the client knows about USER_TOKEN_WIRE from the schema already — we check implementation existence early.

// Shorthand for the common single-instance case
USER_TOKEN_WIRE.defineClient(() => ({ /* ... */ })).create();
```

> Naming note: the verbs are **`define`** (server/inbound) and **`defineClient`**
> (client/outbound). `define` and `defineClient` are two methods precisely because a node
> service is *both* a server and a client (Rule 4). Earlier drafts wrote `defineHandler`;
> it's `define`.

### Same example, the bits the centerpiece glossed over

`TRACE_ID` is a misleading "dumb" poster child — in real life a trace id is **"use the
inbound header, or generate one if absent."** That *is* logic, so it's a **smart** wire —
just one the **library ships** so you never write it:

```ts
// LIBRARY-PROVIDED (grest-ts) — looks dumb, is actually smart (generate-if-absent), ambient.
export const TRACE_ID      = new GGContextKey("TRACE_ID", IsString.nonEmpty)  // always present → demands generation
export const TRACE_ID_WIRE = GGHeader.traceId(TRACE_ID)  // process = set(inbound ?? newId()); you don't implement it
```

A **genuinely** dumb wire is one where *absent → undefined is fine* — no logic, optional
by nature, key is `.orUndefined`:

```ts
export const CLIENT_VERSION      = new GGContextKey("clientVersion", IsString.orUndefined)
export const CLIENT_VERSION_WIRE = new GGHeader("x-client-version", CLIENT_VERSION)   // no .define needed
```

Response metadata the **server sets** (mirror of `Set-Cookie`):

```ts
export const RATELIMIT      = new GGContextKey("rateLimitRemaining", IsUint)
export const RATELIMIT_WIRE = new GGResponseHeader("x-ratelimit-remaining", RATELIMIT)
// backend handler: RATELIMIT.set(n)  → wire emits the header                 ✅ clean
// browser app reading it: "which call did this belong to?" → wrong scope     ❌ a request-key can't answer that.
//   client-side typed response metadata goes in the BODY (or result.meta), not a wire key.
```

A **node** service is also a client of other services. Its `defineClient` differs from the
browser's (via augmentation), and it must NOT read the ephemeral inbound key:

```ts
USER_TOKEN_WIRE.defineClient(() => ({
    value: () => SERVICE_IDENTITY.get(),   // service-to-service identity token
}))
// Relaying the END-USER token downstream is EXPLICIT: capture it into a durable key during
// process(); you cannot read USER_TOKEN_WIRE.get() here — it's ephemeral and already cleared.
```

---

## Rules

### 1. A wire on a schema is REQUIRED — resolve or throw. Public omits it.
`.use(WIRE)` on a schema means every method on that schema parses + (for smart wires)
resolves that wire. A smart wire either produces its result or **throws** — there is no
lenient/optional middle. **Public routes do not list the wire**; they live on a separate,
wire-less schema. So "what's public?" is answered by looking at the schema, not by reading
handler code.

- **No optional auth.** Anonymous-or-personalized endpoints are not supported. If you're
  authenticated, call one endpoint; if not, another. Mixing the two in one handler drags
  security branching back into business logic — exactly what this layer removes. Escape
  hatch (deliberately ugly, off the standard): put the route on a public schema and read
  the raw header yourself via a plain header key. You own that branch's security.
- Single invariant for the whole layer: **a wire either resolves or the request fails.
  No third state.**

### 2. Two tiers: dumb (no implement) vs smart (must implement)
- **Dumb** — `new GGHeader(name, KEY)`. The context key is the argument, so there's
  nothing to implement; the value lands in the key, set-if-present, **ambient** (persists
  through the handler). For values where absent → undefined is acceptable.
- **Smart** — `new GGHeader(name, {scheme})`. Requires `.define()` (server) and/or
  `.defineClient()` (client). The wire key holds the raw inbound value, **ephemeral**, and
  the handler transforms it into a durable principal key (`USER_DATA`, server-side, carrying
  identity + permissions, deep-frozen — see Mechanics).
- "Generate-if-absent" (trace ids, defaults) is **smart, library-provided** — it has an
  implementation; you just didn't write it. The dumb/smart split is unchanged by it.

### 3. Ephemeral (smart) vs ambient (dumb) — the no-leak guarantee
A smart wire's raw value is set during `parse()`, read during `process()` (where it's
verified into `USER_DATA`), then **`clear()`d after `process()`, before the handler runs**.
Lifecycle: `parse (set raw) → process (read raw, mint USER_DATA) → clear → handler`. After
the clear, `WIRE.get()` returns `undefined` (not a throw — a cleared smart wire reads the
same as an unset one). Handlers see `USER_DATA`, never the token. A dumb wire's value is
ambient (handlers read it directly). The lifecycle is implied by the tier — no separate flag.

### 4. `define` (server) / `defineClient` (client) — node has BOTH roles
The split is **inbound vs outbound**, not browser vs node. A browser only does outbound. A
node service does both: it serves requests (`define` → `process`/`permissions`) *and*
calls other services (`defineClient` → `value`). Via augmentation, node's `defineClient`
can differ from the browser's while keeping the same API. **Token relay is explicit**
(capture into a durable key during `process`), never an implicit read of the cleared
inbound key.

### 5. `define` once (frozen structure) / `create` once-per-runtime (async-context)
- **`define` is process-global and frozen-once.** Pure structure (the factory). A second
  `define` throws hard. Freezing it is the hijack boundary: nothing can swap how
  `USER_TOKEN` becomes identity after it's declared.
- **`create(deps)` is once *per runtime*,** binding deps into that runtime's GGLocator
  scope. Multi-runtime tests (`GGTest.startWorker([A,B])`) and start/stop/restart each get
  their own scope; "once" is per-scope, not per-process. Deps passed to `create` **must be
  async-context-bound and stateless** — a normal grest-ts service already is.

### 6. Authn = wire (Rule 1), Authz = per-method `permission`
The wire produces identity and a `permissions()` scope resolver. Per-method `permission`
declarations gate authorization; strict-mode refuse-to-start is unchanged (a method
declaring a permission must have a resolver reachable on its chain — the wire provides it).
The startup walk covers both: **every used wire is implemented**, and **every declared
permission has a resolver**. That is the answer to "check it actually does."

**Multi-wire composition (AND across sources).** A schema may `.use()` more than one auth
wire (e.g. `USER_TOKEN_WIRE` + `ORG_TOKEN_WIRE`). Each wire declares its full permission
enum (today: `AuthToken({permission: IsUserPermission})`), so at compose the runtime builds
a `permissionString → owningWire` index:

- **Permission strings are globally unique across all wires.** Two wires declaring the same
  permission string is **invalid config → crash at startup** — never silently namespaced.
  A collision is almost always a bug; fail loud.
- *Within one source:* a wire's `permissions()` returns the **set** of grants the caller has.
- *Across sources:* a method listing `UserPermission.A` **and** `OrgPermission.B` requires
  **both** — each routed to its owning wire's scope; all must grant (AND).
- **Startup validation falls out:** a method requiring an `OrgPermission` on a schema that
  didn't `.use(ORG_TOKEN_WIRE)` → refuse to start (its owning wire isn't on the chain).

(The contract's `permission` field must accept a list for the multi-source case — confirm
during implementation; examples today show only a single value.)

---

## Security invariants (fail loud, never silently leak)

These are the things to **test against and fight**, not just hope hold:

1. **Client refresh dedup is a browser/outbound concern — not load-bearing here.** The
   `GGContextKeySynchronizer` dedups stale-token refreshes via an `inflight` promise. The
   earlier worry was SSR: one node process rendering many users would share one refresh
   promise by reference and cross-wire user B onto user A's refresh. **We don't SSR this
   client** — each browser process is single-user — so the cross-wire case can't manifest
   and there is no per-request-context work to do. *If we ever server-render many users in
   one process, revisit per-context isolation of the controller registry + inflight.* (The
   synchronizer also moves out of `@grest-ts/context` — see Implementation notes.)
2. **Ephemeral keys read `undefined` after clear.** A smart wire is `clear()`d after
   `process()` (Rule 3); reading it in a handler returns `undefined`, same as an unset key.
   The no-leak guarantee comes from the clear + handlers depending on `USER_DATA`, not from
   a throwing access path.
3. **`create` deps must be async-context-resolved, not captured per-user.** `value: () =>
   session.get()` is correct because `session` is a context store. Passing a concrete
   per-user object to `create` is the SSR footgun; the docs/types must make "context store,
   not instance" unmissable.
4. **`define` frozen-once.** Auth resolution cannot be redefined after declaration (a late
   import can't hijack `process`).

---

## DX / searchability

- **One symbol per concept.** `USER_TOKEN_WIRE` is the hub. `grep USER_TOKEN_WIRE`
  (substring) finds the declaration, every `.use(USER_TOKEN_WIRE)`, the `.define`, the
  `.create`, and the `defineClient`. Name captured handles with the wire as prefix
  (`USER_TOKEN_WIRE_HANDLER`, not `UserTokenWireHandler`) so substring-grep keeps finding
  the `create` site.
- **`ctrl+click` lands on real code.** Behavior is written *at* the `.define()` call site,
  not behind a stub — so navigation works, unlike a method-registry hub.
- **No per-method ceremony.** Auth is declared once per schema; you can't forget it on a
  method, and you can't accidentally make one method public (Rule 1 — that requires a
  separate schema, by design).

---

## Open decisions

- **Trace `default`/generate hook** — confirmed smart + library-provided (Rule 2). Just
  needs the `GGHeader.traceId(...)` (or generic `default:`) helper specified.
- **Response-header read on the client** — leaning "not supported; use the body."
  `ETag`/`If-None-Match` conditional GETs are the one genuine HTTP case with no body slot;
  decide whether that's a `result.meta` affordance or out of scope.
- **`create` typed deps** — bare `USER_TOKEN_WIRE.create(users)` is runtime-checked only;
  capturing `const H = USER_TOKEN_WIRE.define(...)` and calling `H.create(users)` is
  compile-checked. The example uses the captured form to keep the type check; the bare form
  stays available for the shorthand single-instance case.

---

## Implementation notes (AI / implementer — read first; the author may skip this)

You are implementing on `kratt/middleware-v2`. Breaking changes are fine — migrate
grest-ts's own callers, no back-compat shims. Iterate with `npm test -- --run <path>`;
final green via the kratt `run_tests { repo: "grest-ts" }` MCP.

**Substrate already in place** (verify, don't rebuild): `GGContextKey` is already
immutable-by-default with `{mutable:true}` opt-in, and `GG_TRACE` is already the mutable
one. The unified `GGTransportMiddleware` (`parse`/`process`/`respond`/`update` +
`GGInbound`/`GGOutbound`/`GGResponse`) from `MIDDLEWARE_REWRITE.md` has landed and is what
the auth example uses today (`GGHeader.middleware(KEY, opts)`). This plan is phase 2 on top
of it: the smart-wire object model. So sequencing step (a) is mostly migrate-the-3-tests,
not build.

### Foundations carried over from the deleted `WIRE_BINDINGS.md` (still valid, reused here)
- **Immutable-by-default `GGContextKey` is the basis of ephemeral/no-leak.** Set-once
  (`{mutable:true}` opt-in) turns the double-bind footgun into a loud throw and removes
  dirty-tracking. `GGContext` stores values in a per-context `Map` keyed by `token.name`;
  `set` writes the LOCAL map, `get`/`has` walk the parent chain — so "set-once" = throw if
  the LOCAL map already has the key; child-context shadowing stays legal.
- **`GG_TRACE` must be `{mutable:true}`** (`packages/trace/trace/src/GG_TRACE.ts`) — it
  re-inits a fresh trace id per op and testkit reuses one context across actions. This is
  the canonical mutable key and directly relevant to Rule 2 (trace is smart/ambient, not a
  security key). ~3 app-test files re-set a key in a shared `GGContext` and need a fresh
  context or `clear()`: `examples/grest-test/test/{middleware,language}.test.ts`,
  `permissions-ws.test.ts`.
- **Doc-gen wiring must keep working + extend.** OpenAPI
  (`packages-libs/docs/openapi/src/toOpenApi.ts`) reads schema middlewares → header params
  + security; AsyncAPI (`packages-libs/docs/asyncapi/src/toAsyncApi.ts`) mirrors it for WS.
  `GGHeader`/`GGCookie` carry `name`/`scheme`/`schema`/`responseHeaders` metadata so params
  + cookie security schemes emit (cookies were previously shown as Bearer — close that gap).

### Mechanics
- **`GGHeader`/`GGCookie` extend `GGWireContextKey extends GGContextKey`.** Dumb form wraps
  a passed-in key; smart form *is* the (ephemeral) key. Both attach via one `.use()` on the
  http schema and (structurally) the ws schema. `GGResponseHeader` is the server-set mirror.
- **The durable principal is server-only, one key, deep-frozen — shaped to the domain.** A smart
  wire's durable result is read only by server handlers/services — never the client — so it lives
  next to the `.define()` in `server/auth/`, NOT in the shared `api/` contract. One key carries
  identity + permissions (no separate perms key); `permissions()` reads off it; it is
  **deep-frozen** on `set()` (minted inside `process()` from a verified token) so a handler can't
  mutate permissions to escalate — immutable by construction, not per-handler discipline. The
  example freezes explicitly via `deepFreeze` (`@grest-ts/common`); ideally the framework does this
  automatically for smart-wire durable keys.
  - **Model the entity that actually OWNS the permission — don't bolt perms onto a shared entity
    or invent a structural wrapper.** A *user* owns user-level capabilities, so `USER_DATA` **is**
    the `User` (permissions on `IsUser`, sourced from the user record). An *org* does NOT own
    `ORG_MEMBER` — the *membership* does — so model `IsOrgUser {orgId, permissions}`, a domain
    entity parallel to `IsUser`, and `ORG_USER` **is** the `OrgUser`. The shared `Org` stays
    permission-free; `orgInfo` fetches it fresh by `orgId` (membership stays normalized — it holds
    `orgId`, not an org snapshot). Both durable keys end up symmetric: each is the domain entity
    that owns its permissions.
- **Augmentation, env-split.** `define`/`process`/`permissions` (inbound) shipped from the
  node entry; `defineClient`/`value`/`isStale`/`recover` (outbound) shipped from the browser
  entry; **node ships both** (it's a client too). Follow the existing precedent
  (`GGHttpSchema.prototype.createClient` added via `declare module` in the client file, and
  the `index-browser.ts`/`index-node.ts` split). The browser→node leak is prevented by which
  entry exports which — keep that boundary lint-enforced.
- **No new package.** Lives in `@grest-ts/http`; http must not import `@grest-ts/websocket`
  (type the WS half against a local structural handshake shape — precedent:
  `packages/http/http/src/server/GGHttpServer.ts` `AnyWebSocketSchema`). http-only apps pull
  zero ws runtime.
- **`define` registry frozen at first call; `create` writes into the runtime's GGLocator
  scope.** Startup validation walks every registered schema: each `.use`d wire must have a
  `create`d impl on a serving runtime, and each declared `permission` must have a resolver.
  Freeze the resolved per-runtime binding once compose completes.
- **Relocate `GGContextKeySynchronizer` out of `@grest-ts/context` → `@grest-ts/http`**
  (the wire-client home, next to `defineClient`). It is purely a client/outbound concern:
  `waitFor` is called by `GGRpcRequestBuilder` (http), `GGFileUploadRequestBuilder`
  (http-file), `GGSocketPool` (ws) — all already depend on `@grest-ts/http`; `provide` is
  called only by `GGAuthSession` (`packages-libs/auth`, browser), which also depends on http.
  Move `GGContextKeySynchronizer` + `GGKeyController`, drop the two `index-browser.ts` /
  `index-node.ts` re-exports from context, repoint the four importers. Pure relocation — no
  behavior change (the per-request concern is dropped per Security §1). `@grest-ts/context`
  returns to being just context primitives. It becomes the engine behind `defineClient`'s
  `isStale`/`recover`.
- **`defineClient` is the typed successor to `GGContextKeySynchronizer.provide({isStale,
  recover})` — and `GGAuthSession` calls it ITSELF.** `GGAuthSession` already owns the client
  token lifecycle (localStorage persistence, cross-tab refresh dedup via web locks, proactive
  scheduled refresh, status state-machine, derived tokens) and already self-registers
  `{isStale, recover}` with the synchronizer per token — and it already holds the wire refs it
  needs (`withToken(USER_TOKEN_WIRE)`, `addDerived("org", ORG_TOKEN_WIRE)`). So the smallest,
  cleanest change is: the session swaps its internal `GGContextKeySynchronizer.provide(key, …)`
  for `wire.defineClient({value, isStale, recover})` on the wires it owns. **There is no
  app-level `defineClient` in the session case** — the whole client auth setup is the
  `GGAuthSession.withToken(…).addDerived(…)` chain. `grep USER_TOKEN_WIRE` still lands on
  `.withToken(USER_TOKEN_WIRE)`, which IS the client-binding site. `GGAuthSession` therefore
  *is* the library helper we'd otherwise ship (`bearerSession`) — no separate adapter needed.
  - `wire.defineClient(handler)` stays a public, explicit API for the **no-session case** (e.g.
    a static API key: `WIRE.defineClient({value: () => KEY})`). Freeze-once means the session
    and the app must not both call it on the same wire — the session owns it exclusively.
  - **`value()` is sync** (last-known token) while **`isStale()`/`recover()` are async**; the
    synchronizer runs the async pair via `waitFor` *before* the outbound read calls `value()`,
    so the split needs no new concept.
  - The wire stays typed only to the header string; the rich `GGAuthTokensResult` typing lives
    in the session. Do NOT hand-roll `value`/`isStale`/`recover` against a bare context key —
    that drops persistence / cross-tab / proactive-refresh / status and re-introduces the
    anonymous-session `atob` throw.
- **Client permission checks — typesafe, sourced from the wires' enums (UX only).** Because the
  wire carries its permission enum (`GGHeader<P>` from `{permissions: IsUserPermission}`) and the
  session is built from wires, the session can infer the permission union at the type level:
  `withToken(USER_TOKEN_WIRE)` → `P = UserPermission`, each `addDerived(ORG_TOKEN_WIRE)` adds its
  enum. Surface:
  - `session.hasPermission(p)` — `p` typed to the union of all the session's wires' enums; a
    non-member is a compile error. **Single-arg only** — multi is plain code
    (`hasPermission(A) && hasPermission(B)`); no variadic (a combinator mini-language —
    `hasPermission(or(A,B))` — can come later, but plain `&&`/`||` covers it).
  - `session.permissions` — the current granted list (union-typed) for enumeration/display.
  - Runtime: decode the `permissions` claim across the active tokens (root + active derived) and
    test membership. Global-unique permission strings (Rule 6) mean no source disambiguation.
    Reactivity is the existing `session.subscribe()`.
  - **UX ONLY — never a security boundary.** The client decodes its own (forgeable) JWT; the
    server re-verifies the signature and re-runs the wire `permissions()` + per-method gate on
    every call. `hasPermission` decides "render the button," nothing more.

### Tests
- Unit: each wire extracts from its (only its) source; dumb=ambient/optional,
  smart=ephemeral/required; ephemeral key read post-`clear()` → `undefined` (not a throw);
  `define` twice → throw; `create` twice **in one GGLocator scope** → throw (a fresh
  scope — new runtime, restart — may `create` again); duplicate permission string across two
  wires → throw at startup; smart wire's durable principal is deep-frozen (mutating
  `.permissions` throws); doc metadata emitted (header params + cookie security).
- Integration: authed schema rejects anonymous (throw at wire); public (wire-less) schema
  serves anonymous; per-method `permission` gate; **multi-wire AND** — method requiring a
  `UserPermission` + an `OrgPermission` passes only when both wires grant; node
  service-to-service attaches service identity; relay only works when explicitly captured to
  a durable key.
- Full sweep via `run_tests` after each landing.

### Sequencing (risk-ordered; auth example is the proving ground throughout)
a. **Single-token `USER_TOKEN_WIRE`, HTTP only, end-to-end** — `GGHeader`/`GGResponseHeader`
   + dumb form + `.use()`; smart-wire lifecycle (`define`/`defineClient`/`create`, freeze,
   GGLocator scope binding, ephemeral `parse→process→clear`); per-method `permission` gate;
   startup enforcement (used wire implemented, declared permission has a resolver). Migrate
   the ~3 mutable-key tests as part of this. Prove the whole model on the simplest real case.
b. **Multi-wire** — add `ORG_TOKEN_WIRE`: the `permissionString → owningWire` index,
   duplicate-string startup crash, AND-across-sources gate, and the derived/minted org token
   on the client.
c. **Client + WebSocket** — `defineClient` (public API, for the no-session case) + rework
   `GGAuthSession` to call `wire.defineClient(...)` internally on the wires it already holds
   (swapping its `GGContextKeySynchronizer.provide` calls), so app client setup is just the
   `withToken(…).addDerived(…)` chain; relocate `GGContextKeySynchronizer` → `@grest-ts/http`;
   then `GGCookie` + the wire model over the ws schema with per-message permission gate.
