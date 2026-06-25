<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/auth

Access + refresh token auth for grest-ts — **server and client, HTTP and WebSocket**. The server
issues, verifies, and rotates JWTs; the client keeps them fresh and attaches them automatically.
You write no interceptors and no "is my token expired?" checks.

The design rests on the **smart wire**. A token is a `GGHeader` declared once in your api package.
The same wire is listed in a schema's `use` (so requests carry it), given server behaviour with
`.define()` (verify + permission gate), and given client behaviour by the session (attach +
keep-fresh). There are no middleware chains, no `usePermissions`, no `scopeResolver` — the contract
already carries per-route permissions, and the wire carries the token.

```
                 api package (shared)
                 ┌──────────────────────────────┐
   GGHeader  →   │ USER_TOKEN_WIRE = new GGHeader│   ← schemas use:[it]
                 └──────────────────────────────┘
       server .define()  │              │  client (session) .defineClient()
   verify token,         │              │  attach token, refresh when stale
   set principal,        ▼              ▼
   report permissions   GGAuthRefreshToken     GGAuthSession
                        + GGAuthAccessToken     .withToken(...).addDerived(...)
                        + HmacSigner + store
```

A runnable end-to-end app (user token + derived org token + sockets) lives in
[`examples/auth`](../../../examples/auth) — every snippet below is drawn from it.

---

## 1. Define the token wire — once, shared by everyone

A wire is a plain export in your api package, imported by contracts, the server, and the browser.
Alongside it you declare two schemas: the **claims** that ride *inside* the token (the minimal
authz-relevant subset, sent on every request) and the full **identity** the auth endpoints return
as response `data`.

```ts
// api/auth/UserAuth.ts
import {GGHeader} from "@grest-ts/http"
import {IsArray, IsEnum, IsObject, IsString} from "@grest-ts/schema"

export enum UserPermission {
  CAN_UPDATE_RED_BANNER_COUNTER = "CAN_UPDATE_RED_BANNER_COUNTER",
}

export const IsUserId = IsString.brand("UserId")

// Returned to the client as login/refresh `data`, and re-fetched server-side as the principal.
export const IsUser = IsObject({
  id: IsUserId,
  username: IsString,
  email: IsString,
  permissions: IsArray(IsEnum(UserPermission)),
})
export type User = typeof IsUser.infer

// What actually rides inside the access token — only the authz-relevant subset, never the profile.
export const IsUserClaims = IsObject({
  id: IsUserId,
  permissions: IsArray(IsEnum(UserPermission)),
})
export type UserClaims = typeof IsUserClaims.infer

// Smart wire: parses `Authorization: Bearer <jwt>`. The raw token is readable only inside the
// server handler's process(). Behaviour is attached once on the server (.define) and on the
// client (.defineClient, done by the session) — see below.
export const USER_TOKEN_WIRE = new GGHeader("authorization", {scheme: "bearer"})
```

---

## 2. Contracts — `use` the wire, declare per-route permissions

A wire listed in a schema's `use` is **required-or-throw**: every route on that schema must
carry a valid token. Public routes (login/refresh/register) live on a schema with no `use` and
`permission: GG_NO_PERMISSIONS`.

```ts
// api/AuthPublicApi.ts  — PUBLIC: no wire
import {IsGGAuthTokensResult} from "@grest-ts/auth"

export const IsAuthResponse = IsObject({tokens: IsGGAuthTokensResult, data: IsUser})

export const AuthPublicApi = new GGHttpSchema({                 // login/register/refresh
  contract: AuthPublicApiContract,
  pathPrefix: "pub/auth",                                       // no `use` → public
  routes: {register: GGRpc.POST("register"), login: GGRpc.POST("login"), refresh: GGRpc.POST("refresh")},
})

// api/UserApi.ts  — PROTECTED: every route carries + verifies the user token
export const UserApi = new GGHttpSchema({
  contract: UserApiContract,
  pathPrefix: "api/users",
  use: [USER_TOKEN_WIRE],
  routes: {me: GGRpc.GET("me"), updateProfile: GGRpc.PUT("profile")},
})
```

In the contract, each method declares its own `permission` (a value from your permission enum, or
`GG_NO_PERMISSIONS` for "any authenticated caller"). The wire handler (§3) supplies the caller's
permissions; the framework gates each route against them — no resolver wiring at the call site.

`IsGGAuthTokensResult` is the canonical pair shape: `{access: {token, expiresAt}, refresh: {token, expiresAt}}`.

---

## 3. Server — token engine + wire handler

### The token engine

Two composed objects own a token kind end-to-end:

- **`GGAuthAccessToken`** — the stateless access JWT. `issue(subject, claims)` / `verify(token)`.
  Claims are opaque: it validates them against `claimSchema` and signs the registered
  `sub`/`iat`/`exp`/`aud` envelope.
- **`GGAuthRefreshToken`** — wraps an access token with rotation, single-use reuse-detection, and
  revocation, backed by a `RefreshTokenStore`. `issue` / `refresh(token, resolve)` / `revoke` /
  `revokeAll`. Reach its access half via `.access` to verify.

```ts
import {GGAuthAccessToken, GGAuthRefreshToken, HmacSigner, InMemoryRefreshTokenStore} from "@grest-ts/auth"

const userTokenEngine = new GGAuthRefreshToken({
  store: new InMemoryRefreshTokenStore(),         // swap a DB-backed store in prod
  refreshTtlMs: 7 * 24 * 60 * 60 * 1000,          // long-lived, revocable, single-use
  access: new GGAuthAccessToken({
    signer: new HmacSigner(SECRET),               // or any SigningStrategy (KMS/ES256)
    claimSchema: IsUserClaims,
    accessTtlMs: 60 * 60 * 1000,                  // short-lived, stateless
  }),
})
```

The service issues on login and rotates on refresh. `refresh`'s `resolve` callback re-derives the
claims from the subject, so a permission change takes effect on the next refresh — not just on
re-login:

```ts
class UserService {
  constructor(private readonly tokenEngine: GGAuthRefreshToken<UserClaims>) {}

  login = async ({username, password}: LoginRequest): Promise<AuthResponse> => {
    const record = this.table.findByUsername(username)
    if (!record || record.password !== password) throw new InvalidCredentialsError()
    return {tokens: await this.tokenEngine.issue(record.id, record), data: record}
  }

  refresh = async ({refreshToken}: RefreshRequest): Promise<AuthResponse> => {
    let user: User | undefined
    const tokens = await this.tokenEngine.refresh(refreshToken, async (subject) => (user = this.table.get(subject)))
    return {tokens, data: user!}
  }

  // called by the wire handler's process() to turn a raw bearer token into a verified payload
  verifyAccessToken = async (token: string | undefined) => {
    if (!token) throw new NOT_AUTHORIZED({debugMessage: "Missing bearer token"})
    return await this.tokenEngine.access.verify(token)
  }
}
```

### The wire handler

`WIRE.define(deps => ({process, permissions}))` attaches server behaviour to the wire. `process()`
reads the raw token (`WIRE.get()`), verifies it, and sets a **server-only** principal on a
`GGContextKey` (deep-frozen so a handler can't mutate it to escalate). `permissions()` returns that
principal's permissions for the contract's per-route gates. Handlers read the principal straight off
the key — they never see JWT jargon.

```ts
// server/auth/UserAuthHandler.ts
export const USER_DATA = new GGContextKey("userData", IsUser)   // server-only principal

export const USER_TOKEN_WIRE_HANDLER = USER_TOKEN_WIRE.define((users: UserService) => ({
  process: async () => {
    const payload = await users.verifyAccessToken(USER_TOKEN_WIRE.get())
    const user = users.getUserById(payload.data.id)
    if (!user) throw new NOT_AUTHORIZED({debugMessage: "User not found"})
    USER_DATA.set(deepFreeze(user))
  },
  permissions: async () => USER_DATA.get()!.permissions,
}))

// a protected handler just reads the principal — no auth dependency
class UserService {
  me = async (): Promise<User> => USER_DATA.get()!
}
```

### Wiring in `compose()`

No middleware chains. Bind each wire handler's deps into the runtime once with `.create(deps)`, then
register the contracts. Startup refuses to serve a `use`d wire whose handler was never created.

```ts
export class AppRuntime extends GGRuntime {
  public static readonly NAME = "auth"

  protected compose(): void {
    const server = new GGHttpServer()

    const userTokenEngine = new GGAuthRefreshToken({ /* …as above… */ })
    const userService = new UserService(userTokenEngine)

    USER_TOKEN_WIRE_HANDLER.create(userService)   // bind wire deps into this runtime's scope

    new GGHttp(server)
      .http(AuthPublicApi, userService)   // no wire → public
      .http(UserApi, userService)         // USER_TOKEN_WIRE → verified + permission-gated
  }
}
```

> **Identity providers.** The example checks the password inline, but the package ships IdP
> strategies that normalize a provider credential into an `ExternalIdentity` you map to your user:
> `PasswordIdp` (bcrypt by default, via `@grest-ts/auth`'s password export), `GoogleIdp`, `OidcIdp`,
> `OktaIdp`. Each exposes `authenticate(credential) → ExternalIdentity` ({provider, subject, email,
> claims}); the issue tail is identical across providers.

---

## 4. Client — keep it fresh, automatically

`GGAuthSession` owns the whole client-side lifecycle: localStorage persistence, cross-tab refresh
dedup, proactive scheduled refresh, status, and the derived-token selection. It also configures the
wire itself — it holds `USER_TOKEN_WIRE` (via `withToken`) and calls its `.defineClient()` internally,
so there is **nothing to wire per client**.

Subclass it to add UX-only permission helpers over the identity `data` the server returns (the
session can't decode the opaque token, and the server re-checks every call anyway).

```ts
// client/src/api.ts
import {GGAuthSession} from "@grest-ts/auth"

export const api = {
  authApi: AuthPublicApi.createClient({url: ""}),
  userApi: UserApi.createClient({url: ""}),
}

class AppSession extends GGAuthSession {
  hasPermission(p: UserPermission): boolean {
    return ((this.get() as User | undefined)?.permissions ?? []).includes(p)
  }
}

export const session = AppSession.withToken(USER_TOKEN_WIRE, {
  refresh: api.authApi.refresh,     // (token) => AuthResponse — your AuthApi client's refresh
  localStorageKey: "auth",
}) as AppSession
```

Then just use your clients — nothing else to attach:

```ts
await session.init()                              // restore from storage on startup (refresh if expired)
session.start(await api.authApi.login(creds))     // after your login screen: store {tokens, data}

await api.userApi.me()                            // token attached; if stale, the call waits for one refresh first

session.logout()                                  // clears here and in every other tab
```

Because the session registers the token's freshness with the wire, a request never leaves with a
stale token — and a `401`/`403` that does come back is a genuine authorization error, not an expiry
artifact.

### Session state & UI

`getState()` → `{status, refreshing, degraded}`, `status ∈ anonymous | restoring | authenticated | expired`.
It's an external store:

```ts
const s = useSyncExternalStore((cb) => session.subscribe(cb), () => session.getState())
if (s.status === "restoring")      return <Splash/>   // cold load
if (s.status !== "authenticated")  return <Login/>    // anonymous / expired
return <App/>
```

Other methods: `isLoggedIn()`, `get()` (current identity `data`), `onRefreshed(cb)`, `onLogout(cb)`,
`getAccessToken({awaitRefresh})` (only for a raw, non-grest-ts socket that needs the token in a URL).

### Cookie mode

`GGAuthSession.withCookie(wire, {refresh, logout})` instead of `withToken`: the refresh token lives
in an httpOnly cookie scoped to the refresh endpoint, `refresh` is called with no argument, and
`logout` calls your server to clear it. Everything else is identical. The access token always rides
the `Authorization` header in memory regardless of mode.

---

## 5. Sockets — same wire, same story

List the same wire in the socket schema's `use`; per-message permissions are declared on the
contract. The handshake is gated to a fresh token, and every reconnect re-gates.

```ts
// authed socket → connect.errors = [NOT_AUTHORIZED, SERVER_ERROR]
export const LiveApiContract = new GGDuplexContract("LiveApi", {
  connect: {errors: [NOT_AUTHORIZED, SERVER_ERROR]},
  clientToServer: {/* … per-message permissions … */},
  serverToClient: {/* … */},
})

export const LiveApi = new GGWebSocketSchema({contract: LiveApiContract, path: "ws/live", use: [USER_TOKEN_WIRE]})

const socket = LiveApi.createClient({url: WS_URL})
await socket.connect()        // handshake auto-gated to a fresh token; reconnects too
```

---

## 6. Scoped ("derived") tokens — e.g. a tenant/org token

A second token kind, **access-only**, minted *behind* the user token. On the server it's a plain
`GGAuthAccessToken` (no refresh store) with its own signer/audience, its own wire, and its own
principal. On the client the session keeps a **per-tab** active selection (different tabs → different
orgs), and switch-back is cached.

```ts
// api/auth/OrgAuth.ts — own wire (custom header, no bearer scheme) + its own claims/principal
export const ORG_TOKEN_WIRE = new GGHeader("x-org-token", {})
export const IsOrgUser = IsObject({orgId: IsOrgId, permissions: IsArray(IsEnum(OrgPermission))})

// api/OrgApi.ts — one schema to MINT the org token (user-authed only), one for org-scoped reads.
// A wire is required-or-throw, so the route that hands out the org token can't also require it.
export const OrgApi = new GGHttpSchema({
  contract: OrgApiContract,
  pathPrefix: "api/orgs",
  use: [USER_TOKEN_WIRE],                                      // mint behind the user token
  routes: {listOrgs: GGRpc.GET("list"), selectOrg: GGRpc.POST("select")},
})

export const OrgScopedApi = new GGHttpSchema({
  contract: OrgScopedApiContract,
  pathPrefix: "api/org",
  use: [USER_TOKEN_WIRE, ORG_TOKEN_WIRE],                     // both tokens; AND across sources
  routes: {orgInfo: GGRpc.GET("info")},                       // permission: OrgPermission.ORG_MEMBER
})
```

```ts
// server — a second, store-less engine; selectOrg issues it behind the user guard
const orgTokenEngine = new GGAuthAccessToken({signer: new HmacSigner(SECRET + "-org"), claimSchema: IsOrgUser, accessTtlMs: 8 * 60 * 60 * 1000})

class OrgService {
  selectOrg = async ({orgId}: SelectOrgRequest): Promise<SelectOrgResponse> => {
    const user = USER_DATA.get()!                              // verified by the user wire
    if (!this.table.getMemberOrgIds(user.username).includes(orgId)) throw new FORBIDDEN()
    const org = this.table.get(orgId)!
    const orgUser = {orgId: org.id, permissions: [OrgPermission.ORG_MEMBER]}
    return {access: await this.orgTokenEngine.issue(user.id, orgUser), data: org}   // access-only
  }
}
// in compose(): ORG_TOKEN_WIRE_HANDLER.create(orgService), then register OrgApi + OrgScopedApi
```

```ts
// client — register the derived token, point mint at selectOrg, then select per-tab
class AppSession extends GGAuthSession<{org: DerivedConfig<SelectOrgRequest, Org>}> { /* … */ }

export const session = AppSession
  .withToken(USER_TOKEN_WIRE, {refresh: api.authApi.refresh, localStorageKey: "auth"})
  .addDerived("org", ORG_TOKEN_WIRE, {mint: api.orgApi.selectOrg}) as AppSession   // mint → {access, data}

await session.derived.org.select({orgId})   // mints + attaches; typed from mint; per-tab; switch-back cached
session.derived.org.clear()
```

The `mint` function must return `{access: {token, expiresAt}, data}` — exactly the `selectOrg`
response shape.

---

## 7. How rotation & freshness work

**Refresh tokens are rotated and single-use.** A login starts a `familyId`; every rotation carries
it to the child. The store keys records by `SHA-256(token)` — the raw token is never persisted, so a
store leak can't be replayed. Redeeming a refresh token marks it *spent* (not deleted) via an atomic
`markSpent` single-winner gate; re-presenting a spent token, or two concurrent redemptions of the
same token, is treated as **reuse** and revokes the whole family. `revokeAll(subject)` is "log out
everywhere".

**Access tokens never go out stale.** The session registers `isStale`/`recover` on the wire via
`defineClient`. Before the framework reads the token to build a request or handshake, it gates on
freshness: a no-op when fresh, a single coalesced refresh when stale (one refresh for N tabs,
serialized by a Web Lock so a single-use refresh token is never replayed).

---

## Reference

**Server (`@grest-ts/auth`, node entry)** — `GGAuthAccessToken` (`issue`/`verify`),
`GGAuthRefreshToken` (`issue`/`refresh`/`revoke`/`revokeAll`, `.access`), `HmacSigner` /
`SigningStrategy`, `RefreshTokenStore` / `InMemoryRefreshTokenStore`, IdPs (`PasswordIdp` +
`BcryptHasher`/`PasswordHasher`, `GoogleIdp`, `OidcIdp`, `OktaIdp`, `identityFromClaims`,
`ExternalIdentity` / `IdpStrategy`). Node-only (`jose`, `node:crypto`; `bcrypt` peer dep for
passwords).

**Client (`@grest-ts/auth`, browser entry)** — `GGAuthSession.withToken(wire, {refresh, localStorageKey})`
/ `.withCookie(wire, {refresh, logout})` / `.addDerived(name, wire, {mint})`; instance methods
`init`, `start`, `logout`, `getState`, `isLoggedIn`, `get`, `subscribe`, `onRefreshed`, `onLogout`,
`getAccessToken`, `derived.<name>.select/clear`.

**Shared** — `IsGGAuthTokensResult` (the `{access, refresh}` pair), `IsGGAccessTokenData`,
`IsGGRefreshTokenData` and their inferred types.

See [`examples/auth`](../../../examples/auth) for the complete working app, and
[`server/test/auth.test.ts`](../../../examples/auth/server/test/auth.test.ts) for the flow exercised
end-to-end with `@grest-ts/testkit`.
