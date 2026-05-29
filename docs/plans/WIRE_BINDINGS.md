# Plan: transport-symmetric wire bindings + immutable context keys

Status: DESIGN AGREED (2026-05-29), not yet implemented. Supersedes the cookie-specific
parts of `WS_COOKIE_SUPPORT.md` (which is now shipped for the read path).

## Goal

Make **transport irrelevant to the code that reads a value**. The same service
implementation, reading the same context keys, should work whether a value arrived via
an HTTP header, an HTTP cookie, a WS in-band handshake header, or a WS upgrade cookie.
"Auth" vs "a random value" is not a property of the wire — it's only what the consumer
does with the value.

The end-state a contract author writes (identical on both builders):

```ts
httpSchema(C).use(header(TOKEN, {scheme:"bearer"})).use(cookie(SESSION)) ...
webSocketSchema(C).use(header(TOKEN, {scheme:"bearer"})).use(cookie(SESSION)).done()
```

## 1. Wire bindings

Two constructors, each returns a value implementing **both** `GGHttpTransportMiddleware`
and `GGWebSocketMiddleware`, attached with a single `.use(...)` on either builder:

```ts
header(key, { name?, scheme?, schema? })   // reads ONLY the named header (HTTP header / WS in-band handshake header)
cookie(key, { name?, schema? })            // reads ONLY the cookie (HTTP Cookie / WS real upgrade Cookie)
```

Guarantees:
- **Strict single-source.** `cookie()` reads the cookie and nothing else; `header()`
  reads that header and nothing else. No fallback chains. Distinct binding types.
- **Doc metadata travels with the binding** (`name`/`scheme`/`schema`), so OpenAPI +
  AsyncAPI generation is preserved and **cookies become documentable** (`in: cookie`
  param / cookie security scheme) — closing the gap where cookie-authed APIs were
  silently shown as Bearer.
- **One mechanism.** `.use(binding)` is canonical on both builders. The current sugar
  (`httpSchema.useCookie/useHeader`, the `webSocketSchema.useCookie` just added) is
  **removed** — exactly one way. (Breaking; accepted.)

### `aOrB(header(...), cookie(...))` composite (migrations)
A composite binding that accepts EITHER source, for migrations ("legacy header OR new
cookie"). It's opt-in — strict is the default. Requirements: (a) defined precedence when
both are present, (b) merge both bindings' doc metadata into an OpenAPI/AsyncAPI **OR**
security list. Validates the abstraction: composition works because bindings are just
middlewares over one interface.

## 2. Inbound vs outbound — the cookie write split

A cookie write is an **outgoing** concern; it must NOT mutate the inbound context value.
The current `GGContextKeyForCookie.set(value, options)` conflates inbound value, pending
Set-Cookie, and write policy in one mutable slot — which is what forced dirty-tracking
(`current === arrived`) and the empty-string-vs-undefined ambiguity.

Split by direction:
- **Inbound** = `KEY.get()` — what arrived on the wire. Set once by the binding,
  immutable, one stable meaning.
- **Outbound** = `setCookie(KEY, value, options)` — schedules a `Set-Cookie` on the
  response. Options live at the call site. Never touches `KEY.get()`.
- **Gate** = `.setsCookies(KEY)` on the method stays. The error condition moves: it's no
  longer "you mutated the value without the helper" (now impossible — there's no mutate
  API on the read key) but "you called `setCookie` on a method that didn't declare
  `.setsCookies(KEY)` → invalid usage" (runtime; nothing enforceable at compile time).

Consequences:
- **`GGContextKeyForCookie` is retired.** A cookie is now "a plain context key + a
  `cookie(KEY)` read-binding + a `setCookie(KEY,…)` writer." Name = key name; options at
  the write call.
- **Dirty-tracking and the `inbound` snapshot are deleted.** No `""`-vs-`undefined`
  ambiguity — you either scheduled an outbound write or you didn't.
- **WS-correct by construction.** No Set-Cookie on a socket → `setCookie` is HTTP-only;
  inbound reads work on both transports.
- `setCookie(KEY, undefined, opts)` / `clearCookie(KEY, opts)` emits the `Max-Age=0`
  clear.

## 3. Immutable-by-default `GGContextKey`

Default becomes **set-once**: a second `.set()` of the same key within the same context
throws. Mutability is the explicit opt-in: `new GGContextKey(name, schema, {mutable:true})`.
(Child-context shadowing is NOT a re-set — different context store.)

Why: a clean invariant — *every context key is written exactly once, by exactly one
owner*. Turns the double-bind footgun (two bindings → same key) into a loud throw instead
of silent last-writer-wins, and removes the need for any dirty-tracking.

### Empirical finding (subagent, 2026-05-29 — `make set() throw-on-re-set`, ran full grest-ts suite)
Immutable-by-default is viable BUT not free:
- **`GG_TRACE` must be `{mutable:true}`.** `GGContextTraceKey.init()` is
  `this.set(this.getNew())` (`packages/trace/trace/src/GG_TRACE.ts:16`), called from ~8
  framework hot paths; it re-initializes by design (fresh trace id) and re-sets within a
  reused context (testkit runs multiple actions in one context) → ~83 of 112 failures.
  This is a legitimate mutable key (trace carries no identity/security invariant). One-
  line fix; GG_TRACE is the first/canonical user of the opt-in.
- **The cookie rollback re-set (`cookieMiddleware.ts:129`) disappears** with the §2
  redesign — it never exists in the new model.
- **~3 app-test files re-set a key in a shared `GGContext`** and need migration (fresh
  context per call, or a `clear()`): `examples/grest-test/test/middleware.test.ts`,
  `language.test.ts`, `permissions-ws.test.ts` (cache test). These are the expected
  test-only breaks.
- **kratt needs no migration** — it does not consume grest-ts `GGContextKey` (its
  grest-ts-style keys are doc fixtures only).

`clear()`/`revoke()` is YAGNI for now — ship strict set-once; add `clear()` the day a
real in-request "unset then re-set" flow needs it.

## 4. Binding home

New small package `@grest-ts/wire` exporting `header`/`cookie`/`aOrB`/`setCookie`.
Runtime-depends only on `@grest-ts/http`; **type-only** imports the WS middleware/handshake
types from `@grest-ts/websocket` (so http-only apps don't pull a websocket runtime dep).
(Alt considered: keep them in `@grest-ts/http` with a structural WS type — leaner but
fragile. Rejected.)

## 5. Inherent transport edges (document, do NOT guard)

These leak at the edges (client supply / server mint), never in the consuming code:
- **Cookie + Node service-to-service client = no auth.** A `cookie()` binding has no
  client-attach; a Node `createClient` has no cookie jar. Expose the **header**-bound
  variant for S2S, the **cookie**-bound for browsers. Assume developer intelligence; make
  the cookie binding self-evidently browser-oriented in name/docs. No runtime guard.
- **WS values are pinned at connect** (read once at handshake), HTTP per-request. A future
  `refreshAuth` is just reconnect/custom-messaging on top — doesn't change the formula.
- **`header()` on WS is in-band (client-set, spoofable)**; `cookie()` on WS is the real
  upgrade (unspoofable). Same trust split as HTTP (request header vs httpOnly cookie).

## 6. Sequencing (three separable landings)

a. **Bindings + example** (`header`/`cookie`/`aOrB` in `@grest-ts/wire`, the demo app).
   Stands alone.
b. **Immutable-by-default `GGContextKey`** + `{mutable:true}`; mark `GG_TRACE` mutable;
   migrate the ~3 test files.
c. **Cookie write split**: `setCookie()` + `.setsCookies()` gate; retire
   `GGContextKeyForCookie`; delete dirty-tracking.

(b) and (c) reinforce each other (immutability lets us delete dirty-tracking). Build (a)
first as the proof; then (b)+(c).

## 7. The example app — `examples/wire-symmetry`

One contract (logical), one implementation, four wirings (header/cookie × http/ws), all
behind one service instance reading the same context keys.

```ts
// api/Account.ts
export const ACCESS = new GGContextKey<string | undefined>("access", IsString.orUndefined) // credential
export const LOCALE = new GGContextKey<string | undefined>("locale", IsString.orUndefined) // plain value

export const accessViaHeader = header(ACCESS, { name: "authorization", scheme: "bearer" })
export const accessViaCookie = cookie(ACCESS, { name: "access" })
export const localeViaHeader = header(LOCALE, { name: "x-locale" })
export const localeViaCookie = cookie(LOCALE, { name: "locale" })

const whoami = { success: IsObject({ user: IsString, locale: IsString }), errors: [NOT_AUTHORIZED, SERVER_ERROR] }
export const AccountHttp = new GGContractClass("Account", { whoami })
export const AccountWs   = defineSocketContract("AccountWs", {
    clientToServer: { whoami: { ...whoami, permission: GG_NO_PERMISSIONS } },
    serverToClient: {},
})
```

```ts
// AccountService.ts — identical for every wiring
const userFromAccess = () => { const t = ACCESS.get(); return t?.startsWith("tok-") ? t.slice(4) : undefined }
export class AccountService {
    whoami = async () => {
        const user = userFromAccess()
        if (!user) throw new NOT_AUTHORIZED()
        return { user, locale: LOCALE.get() ?? "en" }
    }
    handleConnection = (incoming: WebSocketIncoming<...>) => incoming.on({ whoami: this.whoami })
}
```

```ts
// wiring.ts — only the bindings differ
export const AccountHttpHeader = httpSchema(AccountHttp).pathPrefix("api/h").use(accessViaHeader).use(localeViaHeader).routes({ whoami: GGRpc.GET("whoami") })
export const AccountHttpCookie = httpSchema(AccountHttp).pathPrefix("api/c").use(accessViaCookie).use(localeViaCookie).routes({ whoami: GGRpc.GET("whoami") })
export const AccountWsHeader   = webSocketSchema(AccountWs).path("ws/h").use(accessViaHeader).use(localeViaHeader).done()
export const AccountWsCookie   = webSocketSchema(AccountWs).path("ws/c").use(accessViaCookie).use(localeViaCookie).done()
```

```ts
// compose() — one service instance behind all four
const account = new AccountService()
new GGHttp(server).http(AccountHttpHeader, account).http(AccountHttpCookie, account)
AccountWsHeader.register(account.handleConnection)
AccountWsCookie.register(account.handleConnection)
```

## 8. Tests

- Unit: each binding extracts from its (and only its) source; `aOrB` precedence; doc
  metadata emitted.
- Integration: all four wirings hit the same `AccountService` and return identical
  results given the credential on the matching transport; cross-checks (cookie binding
  ignores a header, header binding ignores a cookie); `setCookie` without `.setsCookies`
  → invalid-usage error; immutable key re-set → throw; `{mutable:true}` key re-set → ok.
- Full sweep via `run_tests` after each landing.
