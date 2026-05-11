# Plan: Contract-level Permissions

## Goal

Move endpoint authorization from "developer must remember to write a check" to "the contract declares the required permission and the framework enforces it." The token format and identity model stay app-defined; the framework owns the *gate* (extract scopes → compare against the contract's declared requirement → reject or pass).

## What this changes

1. `GGContractMethod` grows a **mandatory** `permission` field — TypeScript refuses to compile a method without it.
2. A pure `satisfies(required, scopes)` checker lives in `@grest-ts/schema`. Unit-tested once, never re-implemented per app.
3. `GGHttp.usePermissions(getScopes)` registers a zero-arg scope resolver that reads from app context (set by an upstream auth middleware). The gate runs between `parseRequest` and `implFn`.
4. WebSocket gets the same model: every `clientToServer` method declares `permission`; `serverToClient` methods do not (server originates). Connection-level permission is an optional builder method for feature-specific sockets.
5. At server start, the framework walks every registered schema. Any non-PUBLIC method with no validator wired → hard fail with an actionable error.
6. OpenAPI / AsyncAPI / api-docs generators emit accurate permission metadata.

## Non-goals

- **Object-level authorization** ("user can edit *their own* post") — depends on runtime request data and stays in user code via `GGContextKey` + explicit checks. The plan documents this gap prominently; the framework gate is a *necessary* check, not a *sufficient* one.
- **Token validation** — apps own this. JWT, opaque tokens, session cookies, mTLS — any of them work as long as the app's auth middleware populates context with something the scope resolver can read.
- **Policy engines** — OPA, Cedar, SpiceDB are valid backends for the scope resolver, but the framework has no opinion on them.

---

## 1. Permission algebra

All exports live in `@grest-ts/schema` under a new `permission/` subdirectory.

### Constants

```typescript
export const GG_NO_PERMISSIONS = Symbol.for("@grest-ts/permission/none")
export const GG_ANY_PERMISSION = Symbol.for("@grest-ts/permission/any")

export type GGPermission =
    | typeof GG_NO_PERMISSIONS                                          // truly public — no auth required
    | typeof GG_ANY_PERMISSION                                          // authenticated identity required, any non-empty scope set passes
    | string                                                            // single specific scope
    | {allOf: readonly [GGPermission, ...GGPermission[]]}               // all must hold (non-empty tuple)
    | {anyOf: readonly [GGPermission, ...GGPermission[]]}               // at least one must hold (non-empty tuple)
```

A bare string *is* a scope — no wrapper needed. The combinator objects are structurally distinct from strings, so there's no ambiguity in the union, and `typeof required === "string"` is a clean discriminant in `satisfies()`.

### No exported helpers

No `scope()`, no `allOf()`, no `anyOf()` exports. Users write the literal form directly:

```typescript
permission: AppPermission.ItemsRead
permission: {anyOf: [AppPermission.ItemsWrite, AppPermission.Admin]}
permission: {allOf: [AppPermission.UsersWrite, AppPermission.UsersOwner]}
permission: {anyOf: [AppPermission.ItemsRead, {allOf: [AppPermission.UsersWrite, AppPermission.UsersOwner]}]}
```

Reasons:
- `anyOf` / `allOf` are too generic to claim from `@grest-ts/schema` — they collide with names users already give to schema/validation combinators and add import noise.
- The literal form matches OpenAPI/JSON-Schema vocabulary one-to-one — no translation step in the doc generators.
- Helper-side validation is duplicated work: well-formedness has to be checked wherever the tree is consumed (gate, OpenAPI emit, startup walk), so a single validation pass is enough.

### Validation

Well-formedness is enforced in two places:

- **Compile time** — the non-empty tuple types (`[GGPermission, ...GGPermission[]]`) make `{anyOf: []}` and `{allOf: []}` type errors. This is the primary defense.
- **Contract-construction time** — `GGContractClass`'s constructor walks every method's `permission` tree once at definition time and rejects: empty arrays (bypassed types via `as`), depth > 3 (see open question on DNF), and unknown shapes. This covers `as` casts, dynamic data, and runtime-built permission trees.

No checks live inside `satisfies()` — by the time the gate runs, the tree is known well-formed. Hot-path stays branch-free of validation.

### `GGPermissionChecker` — exposed for user code

The framework wraps the resolved scope set in a class so handler code can run sub-checks against the *same* logic the gate uses. No parallel implementations, no drift.

```typescript
export class GGPermissionChecker {
    constructor(public readonly scopes: ReadonlySet<string>) {}
    has(permission: GGPermission): boolean { return satisfies(permission, this.scopes) }
}

export const GG_PERMISSIONS = new GGContextKey<GGPermissionChecker>("permissions", ...)
```

When the gate runs (HTTP per-message or WS per-message/handshake), it resolves scopes once, wraps them into a `GGPermissionChecker`, and `GG_PERMISSIONS.set(checker)` on the request context. The framework then calls `checker.has(method.permission)` for its own gate check.

Handler code accesses the same checker for finer-grained decisions:

```typescript
public update = async (input: UpdateRequest): Promise<Item> => {
    const item = await this.db.items.find(input.id)
    if (!item) throw new NOT_FOUND()

    const perm = GG_PERMISSIONS.get()
    if (perm.has(AppPermission.Admin)) {
        return await this.db.items.update(input.id, input.data)
    }
    const user = UserContext.get()
    if (perm.has(AppPermission.Owner) && item.ownerId === user.id) {
        return await this.db.items.update(input.id, input.data)
    }
    throw new FORBIDDEN()
}
```

**Population rule.** Whenever a scope resolver is wired (`.usePermissions(...)`), the gate populates `GG_PERMISSIONS` for *every* request — including those targeting `GG_NO_PERMISSIONS` methods. Public endpoints can still personalize for authenticated callers via `GG_PERMISSIONS.tryGet()`. If no resolver is wired, the key is never set.

**API surface.** Only `has(permission: GGPermission)` and the raw `scopes` accessor. No `hasAll(...)`/`hasAny(...)` shorthands — they'd just be sugar for `has({allOf: [...]})`/`has({anyOf: [...]})` and double the surface area for negligible win.

**Resolver signature stays unchanged.** The app still implements `() => ReadonlySet<string> | null`. The framework owns checker construction, so the class can grow (cache derived sets, lazy expansion, etc.) without breaking app resolvers.

Empty arrays are constructor-rejected: vacuous `allOf` shouldn't silently pass, vacuous `anyOf` shouldn't silently fail. If you want "no permission required" the answer is `GG_NO_PERMISSIONS`, not `allOf()`.

### Centralizing scopes — enum convention

The framework accepts plain strings, but the *recommended pattern* (documented in the readme and used in every example) is a project-scoped enum:

```typescript
// app/src/api/AppPermission.ts
export enum AppPermission {
    ItemsRead   = "items:read",
    ItemsWrite  = "items:write",
    UsersAdmin  = "users:admin",
    ChatConnect = "chat:connect",
    ChatWrite   = "chat:write",
}
```

Then in contracts:

```typescript
permission: AppPermission.ItemsRead
permission: {anyOf: [AppPermission.ItemsWrite, AppPermission.UsersAdmin]}
```

The enum is the single source of truth for the project's permission catalog — typos become compile errors, "find all uses of `ItemsWrite`" becomes a one-keystroke navigation, renaming is a refactor not a search-and-replace through string literals.

Plain string literals are also accepted (for token formats that emit ad-hoc scopes), but the docs guide projects toward an enum from day one.

---

## 2. Contract change

**File:** `packages/schema/schema/src/contract/GGContractClass.ts`

```typescript
export interface GGContractMethod<Request = any, Response = any, ErrorsUnion extends ANY_ERROR_CLS = any> {
    input?: GGSchema<Request>
    success?: GGSchema<Response>
    errors?: ErrorsUnion[]
    permission: GGPermission   // NEW — mandatory
}
```

**Breaking change.** Every existing contract method in every grest-ts project must add `permission`. Greppable, fixable in one pass per project. No deprecation window — single release, flip the switch.

**Errors must be listed explicitly.** If `permission !== GG_NO_PERMISSIONS`, the method's `errors:` array MUST include both `NOT_AUTHORIZED` and `FORBIDDEN`. `GGContractClass`'s constructor validates this at contract definition time and throws a clear error if either is missing. No auto-extension — the philosophy matches the mandatory `permission` field: force the developer to see the error paths the framework can throw on this method. Doc generators and client types stay accurate without inference.

---

## 3. Pure checker

**File:** `packages/schema/schema/src/contract/permission/satisfies.ts`

```typescript
export function satisfies(required: GGPermission, scopes: ReadonlySet<string>): boolean {
    if (required === GG_NO_PERMISSIONS) return true
    if (required === GG_ANY_PERMISSION) return scopes.size > 0
    if (typeof required === "string") return scopes.has(required)
    if ("allOf" in required) return required.allOf.every(p => satisfies(p, scopes))
    if ("anyOf" in required) return required.anyOf.some(p => satisfies(p, scopes))
    return false
}
```

Pure, no I/O, recursive on the tree. Unit tests in the framework cover every combinator and every edge case once.

Truth table:

| `required` | `scopes` | result |
|---|---|---|
| `GG_NO_PERMISSIONS` | anything (including null/empty) | `true` (never called for null — handled earlier) |
| `GG_ANY_PERMISSION` | `Set()` | `false` |
| `GG_ANY_PERMISSION` | `Set("x")` | `true` |
| `"a"` | `Set("a", "b")` | `true` |
| `"a"` | `Set("b")` | `false` |
| `{allOf: ["a", "b"]}` | `Set("a")` | `false` |
| `{allOf: ["a", "b"]}` | `Set("a", "b")` | `true` |
| `{anyOf: ["a", "b"]}` | `Set("a")` | `true` |
| `{anyOf: [{allOf: ["a", "b"]}, "c"]}` | `Set("c")` | `true` |

---

## 4. HTTP gate

### Validator interface

A zero-arg function that reads from app context (populated by an upstream auth middleware). Sync or async — both supported:

```typescript
export type GGScopeResolver =
    () => ReadonlySet<string> | null
        | Promise<ReadonlySet<string> | null>
```

- `null` — no caller identity available → framework throws `NOT_AUTHORIZED`
- a set — caller is authenticated → framework calls `satisfies(required, set)` → throws `FORBIDDEN` on miss

The gate `await`s the resolver result unconditionally. Sync returns pay only a microtask (negligible). Async is for cases where scopes have to be fetched from a DB or upstream service (uncommon — preferred pattern remains "auth middleware pre-resolves into context, resolver reads context synchronously" — but the door stays open).

### Wiring on `GGHttp`

**File:** `packages/http/http/src/server/GGHttp.ts`

Adds one builder method, snapshot semantics consistent with `.use()`:

```typescript
public usePermissions(resolver: GGScopeResolver): this {
    this.permissionResolver = resolver
    return this
}
```

The resolver is snapshotted into each subsequent `.http(...)` call, so order matters and reads top-to-bottom as the actual request flow:

```typescript
new GGHttp(httpServer)
    .use(new JwtAuthMiddleware(secret))   // parses token → UserContext.set(...)
    .usePermissions(getScopes)             // reads UserContext → scope set
    .http(ItemApi, new ItemApiImpl())
```

Calling `.usePermissions()` *after* `.http()` means that http() call has no resolver attached — and if its schema has any non-`GG_NO_PERMISSIONS` method, the startup check (§6) fails with an actionable error. No silent under-protection possible.

### Request flow

**File:** `packages/http/http/src/server/GGHttpSchema.startServer.ts`

Between `requestParser.parseRequest(req)` (line 128) and `implFn(rpcInput)` (line 130), insert the gate:

```typescript
const required = contractFunctionSchema.permission
if (config.permissionResolver) {
    const scopes = await config.permissionResolver()
    if (scopes != null) GG_PERMISSIONS.set(new GGPermissionChecker(scopes))
    if (required !== GG_NO_PERMISSIONS) {
        if (scopes == null) throw new NOT_AUTHORIZED()
        if (!satisfies(required, scopes)) throw new FORBIDDEN()
    }
} else if (required !== GG_NO_PERMISSIONS) {
    // unreachable in practice — startup check prevents this configuration
    throw new SERVER_ERROR()
}
rpcResult = {success: true, type: "OK", data: await implFn(rpcInput)}
```

`config.permissionResolver` is passed alongside `middlewares` from `GGHttp`. The `await` is unconditional (so sync and async resolvers share one code path); for sync resolvers the cost is a single microtask. `GG_PERMISSIONS` is populated for every request when a resolver is wired — including `GG_NO_PERMISSIONS` methods — so public handlers can still call `GG_PERMISSIONS.tryGet()` to personalize for authenticated callers.

### Sample resolver

```typescript
const getScopes = (): ReadonlySet<string> | null => {
    const user = UserContext.tryGet()
    return user ? new Set(user.scopes) : null
}
```

Token-parsing strategy is fully app-owned: JWT, session cookie, API key — all populate `UserContext` (or whatever the app names its context key), and the resolver bridges that to a scope set.

---

## 5. WebSocket gate

**File:** `packages/http/websocket/src/schema/webSocketSchema.ts`

### Per-message — mandatory on `clientToServer`

Every `clientToServer` method declares `permission`. Same gate, same rules.

```typescript
export const ChatContract = defineSocketContract("Chat", {
    clientToServer: {
        sendMessage: {
            input: IsMessage,
            success: IsVoid,
            errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
            permission: AppPermission.ChatWrite,   // mandatory
        },
        subscribe: {
            input: IsRoomId,
            success: IsVoid,
            errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
            permission: AppPermission.ChatRead,
        },
    },
    serverToClient: {
        onMessage: {
            input: IsMessage,
            // no permission field — server originates these
        },
    },
})
```

`serverToClient` methods *do not have* a `permission` field at the type level — adding one is a type error. Read access is enforced via the subscribe message's permission, not via the push.

### Connection-level — optional, per the builder

For feature-specific sockets ("this socket only exists for chat — reject the connection up front if you can't use any of it"), the builder adds:

```typescript
export const ChatApi = webSocketSchema(ChatContract)
    .path("/chat")
    .use(AuthMiddleware)
    .connectPermission(AppPermission.ChatConnect)   // optional, sits next to queryOnConnect
    .done()
```

Enforcement happens at handshake: the same scope resolver is called, `satisfies()` against the connect permission, reject with HTTP `401`/`403` before opening the socket. Saves resources and gives the client a clean error before they invest in a connection.

General multiplex sockets simply omit `.connectPermission(...)` — anyone authenticated can connect, each message is gated individually.

### Resolved scopes are cached per-connection

The resolver runs once at handshake and the result is stored on the connection (alongside other handshake-time context). Per-message gates read this cached set — no re-parsing tokens for every message.

---

## 6. Startup check

Runs from `server.onStart(...)` (HTTP) and the equivalent in `GGSocketServer` (WebSocket).

**Crash rule:** for each `GGHttp` / `GGSocketServer` instance, walk every method on every registered schema. If *any* method is non-`GG_NO_PERMISSIONS` and no resolver is wired → throw.

**Silent-start rule:** if all methods are `GG_NO_PERMISSIONS`, the server starts without a resolver. No warning — public-only services exist and are legitimate.

**No "resolver wired but unused" warning** — also legitimate (a service might start all-public and grow protected methods later).

Error format (HTTP example, same shape for WS):

```
GGHttp: cannot start — these methods declare non-public permissions but
no scope resolver was registered via .usePermissions():

  ItemApi.list     requires "items:read"
  ItemApi.create   requires {anyOf: ["items:write", "admin"]}
  UserApi.delete   requires "users:admin"

Fix: add .usePermissions(yourScopeResolver) before .http(...) calls,
     or set permission: GG_NO_PERMISSIONS on methods that are genuinely public.
```

The renderer recurses through `GGPermission` to produce the human-readable form.

---

## 7. Doc generator integration

### OpenAPI (`packages-libs/docs/openapi`)

Native fit — OpenAPI 3 has first-class `security` per operation plus `securitySchemes`.

Mapping rules:
- `GG_NO_PERMISSIONS` → `security: []` (explicit empty array — OpenAPI spec convention for "no security required", *not* omitted)
- `GG_ANY_PERMISSION` → `security: [{bearerAuth: []}]` (any authenticated bearer, no specific scope required — OpenAPI's empty-scopes-array semantic)
- bare string `"x"` → `security: [{bearerAuth: ["x"]}]`
- `allOf(...)` → multiple scopes inside one requirement object: `security: [{bearerAuth: ["a", "b"]}]`
- `anyOf(...)` → multiple requirement objects (logical OR): `security: [{bearerAuth: ["a"]}, {bearerAuth: ["b"]}]`
- Nested `anyOf` containing `allOf` is the only awkward case — flatten to disjunctive normal form at emit time.

A default `bearerAuth` scheme is emitted into `securitySchemes` unless the app provides one explicitly.

### AsyncAPI (`packages-libs/docs/asyncapi`)

AsyncAPI 3 inherits OpenAPI's security scheme shape on operations. Same mapping. WebSocket connect-level permission goes on the channel binding; per-message permissions go on the message operation.

### apiDocs (`packages-libs/docs/api-docs` — our own renderer)

Since we own the UI, this is where wording matters most.

Each method gets a **Permissions** block:

> **Permissions** — *enforced by the framework*
>
> Requires `items:write` **or** `admin`.

For `GG_NO_PERMISSIONS`: *"Public — no authentication required."*
For `GG_ANY_PERMISSION`: *"Any authenticated identity."*
For combinators: render the tree in plain English (`allOf` → "and", `anyOf` → "or"), bold the scope strings.

A persistent banner at the top of every contract page makes the boundary clear:

> Permissions declared on contract methods gate *endpoint access* — whether the caller is allowed to invoke the method at all. They do not cover *resource access* ("can this user edit *this specific* post"); that check remains in the implementation.

This callout is non-negotiable. Without it, "framework guarantees permissions" becomes a false security promise.

---

## 8. Industry-standards alignment

| Standard | How we align |
|---|---|
| **OAuth 2.0 scopes** (RFC 6749) | Scope strings are the unit. Framework is neutral on naming (`items:read` vs `read:items`). |
| **OpenAPI 3 security** | `GGPermission` algebra maps cleanly: `allOf`→AND-within-requirement, `anyOf`→OR-across-requirements, `GG_NO_PERMISSIONS`→`security: []`. |
| **AsyncAPI 3 security** | Same mapping; channel + message granularity matches our connect-level + per-message split. |
| **JWT `scope` claim** (RFC 8693) | Common implementation. Resolver returns the parsed `scope` set. Framework stays format-neutral. |
| **Policy engines** (OPA, Cedar, SpiceDB) | Compatible as resolver backends — resolver can synthesize scopes from a policy decision. |

### What's novel

Compile-time mandatory `permission` on every contract method is **not** standard — NestJS Guards, FastAPI Security, tRPC middleware, Spring `@PreAuthorize`, gRPC interceptors are all optional/runtime. This is a stronger guarantee than other frameworks ship. Worth saying explicitly in the readme so reviewers from other ecosystems don't mistake it for a familiar feature with the same shape.

### What this is not

- Not an authorization *engine* — no policy rules, no relationship graph, no row-level rules. The framework gates endpoints; everything beyond that is app code.
- Not a token format — the resolver returns scopes from whatever the app parsed; the framework does no JWT verification.
- Not a complete auth story — see the apiDocs callout: object-level checks remain a developer responsibility.

---

## 9. Examples

### HTTP — typical service

```typescript
// app/src/api/AppPermission.ts
export enum AppPermission {
    ItemsRead  = "items:read",
    ItemsWrite = "items:write",
    Admin      = "admin",
}

// app/src/api/ItemApi.ts
export const ItemApiContract = new GGContractClass("ItemApi", {
    list: {
        success: IsArray(IsItem),
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: AppPermission.ItemsRead,
    },
    create: {
        input: IsCreateItemRequest,
        success: IsItem,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: {anyOf: [AppPermission.ItemsWrite, AppPermission.Admin]},
    },
    delete: {
        input: IsObject({id: IsUint}),
        errors: [NOT_AUTHORIZED, FORBIDDEN, NOT_FOUND, SERVER_ERROR],
        permission: AppPermission.Admin,
    },
})

// app/src/api/PublicApi.ts
export const HealthApiContract = new GGContractClass("HealthApi", {
    ping: {
        success: IsString,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,   // truly public
    },
})

// app/src/AppRuntime.ts
protected compose() {
    const httpServer = new GGHttpServer()

    // public endpoints — no resolver needed
    new GGHttp(httpServer)
        .http(HealthApi, new HealthApiImpl())

    // protected endpoints
    new GGHttp(httpServer)
        .use(new JwtAuthMiddleware(this.config.jwtSecret))
        .usePermissions(getScopes)
        .http(ItemApi, new ItemApiImpl(db))
}
```

### WebSocket — feature socket with connect-level gate

```typescript
export const ChatApi = webSocketSchema(ChatContract)
    .path("/chat")
    .use(AuthMiddleware)
    .connectPermission(AppPermission.ChatConnect)
    .done()
```

---

## 10. Testing strategy

This is a framework-level change that touches the contract, HTTP, WebSocket, and doc-gen layers. The integration test suite needs *real* coverage end-to-end via `@grest-ts/testkit`.

### Existing test APIs — mass update

Every contract in every test fixture under `packages/*/test/`, `examples/`, and `packages-libs/*/test/` currently lacks `permission`. They will all stop compiling. Mass-update pass: add `permission: GG_NO_PERMISSIONS` to every method except in tests that specifically exercise auth (those get real scopes).

Scope of the update is bounded — `grep -rn "errors:\s*\[" packages packages-libs packages-tooling examples` enumerates every contract method.

### New test APIs (under `packages/http/http/test/integration/permissions/`)

| Test API | What it exercises |
|---|---|
| `PermissionsApi` | every combinator: `GG_NO_PERMISSIONS`, `GG_ANY_PERMISSION`, single scope string, `{allOf: [...]}` (2 and 3 scopes), `{anyOf: [...]}` (2 and 3 scopes), nested `{anyOf: [{allOf: [...]}, ...]}` |
| `MixedApi` | one public and one protected method on the same contract; both routes reachable, only the protected one gated |
| `MissingResolverApi` | non-public method on a `GGHttp` with no `.usePermissions(...)` — used by a negative test that asserts startup throws with the expected error message |
| `AllPublicApi` | all `GG_NO_PERMISSIONS` methods on a `GGHttp` with no resolver — used by a positive test that asserts server starts cleanly |

### Test scenarios (vitest + `GGTestContext`)

For each scenario, the test uses `TestContext` extended with `.scopes(...)` helper that stuffs a controlled scope set into the auth context.

1. **Pure checker** — table-driven unit tests on `satisfies()` covering the truth table above and all combinator nesting.
2. **HTTP gate happy path** — caller with matching scopes → method runs, returns expected value.
3. **HTTP gate `NOT_AUTHORIZED`** — caller without identity (resolver returns null) on a non-public method → `NOT_AUTHORIZED`, handler not invoked.
4. **HTTP gate `FORBIDDEN`** — caller with identity but missing scope → `FORBIDDEN`, handler not invoked.
5. **HTTP gate public method** — caller with no identity on a `GG_NO_PERMISSIONS` method → method runs.
6. **HTTP gate `GG_ANY_PERMISSION`** — empty scope set → `FORBIDDEN`; any non-empty → method runs.
7. **Combinator scenarios** — `allOf`, `anyOf`, nesting, against various scope sets.
8. **Startup check fires** — register `MissingResolverApi` without `.usePermissions(...)` → `GGTest.startWorker(...)` rejects with the expected error message containing the offending method names.
9. **Startup check silent** — register `AllPublicApi` without `.usePermissions(...)` → starts cleanly.
10. **Order-sensitivity** — `.http()` before `.usePermissions()` → that schema's protected methods trigger the startup check.
11. **WebSocket per-message** — connection accepted, message with insufficient scopes → message-level error, connection stays open.
12. **WebSocket connect-level reject** — `.connectPermission(...)` set, caller lacks the scope → handshake rejected before socket opens.
13. **WebSocket s2c emit** — server pushes regardless of scopes (server originates); but a `subscribe` c2s gate prevents subscription in the first place.
14. **Contract construction rejects missing error types** — defining a non-public method whose `errors:` array lacks `NOT_AUTHORIZED` or `FORBIDDEN` throws at `new GGContractClass(...)` time with a clear message naming the offending method.
15. **OpenAPI emit** — table-driven test: each combinator → expected `security` shape, including the `anyOf(allOf(...))` flatten-to-DNF case.
16. **apiDocs render** — snapshot tests for each combinator's rendered "Permissions" block.

### Test layout

```
packages/http/http/test/integration/permissions/
  PermissionsApi.ts              # contract
  PermissionsApiImpl.ts          # implementation
  permissions.test.ts            # scenarios 2–7, 10
  startup-check.test.ts          # scenarios 8–9
  client-error-types.test.ts     # scenario 14

packages/http/websocket/test/integration/permissions/
  ChatPermissionsContract.ts
  permissions.test.ts            # scenarios 11–13

packages/schema/schema/src/contract/permission/satisfies.test.ts   # scenario 1

packages-libs/docs/openapi/test/security.test.ts                   # scenario 15
packages-libs/docs/api-docs/test/permissions-render.test.ts        # scenario 16
```

---

## 11. README updates

Three sources of truth, each with its own audience.

- **Repository root `README.md`** — 1-2 sentences. Surface that grest-ts contracts include mandatory `permission` declarations enforced by the framework, with a link to the HTTP and WebSocket package READMEs for details. The root README is the elevator pitch; it must mention this exists but not drown the casual reader.

- **`packages/http/http/README.md`** — one paragraph covering:
  - That every contract method declares `permission` and the HTTP gate enforces it before the handler runs.
  - The wiring chain (`.use(auth) → .usePermissions(getScopes) → .http(...)`) and what each piece is responsible for.
  - The hard guarantee: a non-public method cannot be served without a wired resolver — the server refuses to start. No silent under-protection.
  - The explicit non-guarantee: this gates *endpoint access*; resource-level checks (ownership, tenant scoping) remain in handler code, and `GG_PERMISSIONS.get()` is provided for those handler-side checks.

- **`packages/http/websocket/README.md`** — one paragraph covering:
  - Per-message gating on every `clientToServer` method (mandatory `permission`); `serverToClient` methods have no `permission` field by design.
  - Optional `.connectPermission(...)` for feature-specific sockets — handshake-time reject vs. per-message reject.
  - Scope resolution runs once at handshake and is cached on the connection; per-message gates read the cached set.
  - Same compile-time mandatory + startup-fail guarantees as HTTP.

The `@grest-ts/schema` README also gets a short subsection introducing `GGPermission`, the constants, and `GGPermissionChecker`. That subsection is reference-style (terse, just enough to find the right type), since the conceptual "how it works" lives in the HTTP/WebSocket READMEs where the gate actually runs.

## 12. Migration / rollout

- Single breaking release. No optional-then-required transition.
- `CHANGELOG`: a top-billed entry with the upgrade recipe — "add `permission` to every method; the compiler will tell you where; use `GG_NO_PERMISSIONS` if you have no auth model yet."
- Codemod is *not* worth writing — it can't infer intent (which methods should be public vs which should be protected), and the right answer is for projects to think about each method exactly once. The compile errors are the migration tool.

---

## 13. Open questions

1. **`anyOf(allOf(...))` flatten to DNF for OpenAPI** — is the upper bound on output size acceptable? Worst case `anyOf(allOf(a,b,c), allOf(d,e,f), allOf(g,h,i))` produces three requirement objects, each with three scopes — fine. Deeper nesting could blow up; we'll cap depth at 3 levels and reject deeper trees at construction time with a clear error.
2. **Connection-level WS permission and per-message permission overlap.** If a method requires `chat:write` and the connection requires `chat:connect`, the per-message check still runs (we don't infer that `chat:connect` implies anything about `chat:write`). Document explicitly: connect-level is a *gate*, not an *inheritance*.
3. **Should `GG_ANY_PERMISSION` accept empty scope sets?** Current decision: no — empty set fails (`scopes.size > 0`). Rationale: lets apps distinguish "authenticated identity with some assigned role" from "authenticated identity with nothing assigned yet" (e.g. just-registered users awaiting role assignment). Apps that don't care can issue every user a baseline scope like `user:basic` and the distinction collapses.
4. ~~**Resolver async signature?**~~ **Resolved.** Both sync and async are supported. Door stays open for resolvers that need DB / upstream lookups; the preferred pattern remains pre-resolving in auth middleware.
5. **Field name `permission` vs OpenAPI's `security`?** Keep `permission` — grest-ts speaks the language of the developer reading the contract ("what permission does this need?") rather than the security-tool reader. Doc generators bridge to OpenAPI's `security` at emit time.
