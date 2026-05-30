# @grest-ts/auth

Token auth for grest-ts — server and client, HTTP and WebSocket — linked by one token. You configure only what the library can't know (your secret, your permission enum, how to verify a login); rotation, cross-tab sync, freshness gating, and the wire plumbing are the library's job.

> Target surface. Some pieces (`GGAuth`, `.useAuth`) are the API we're building toward; this README is the spec for how it should *feel*.

## The whole happy path

```ts
// shared (api package) — the token key + how it rides the wire (two plain exports)
import {GGContextKey} from "@grest-ts/context"
import {header} from "@grest-ts/http"
import {IsString} from "@grest-ts/schema"

export const IsAccessToken = IsString.orUndefined.brand("AccessToken")
export const IsUser = IsObject({userId: IsString})

export const ACCESS_TOKEN = new GGContextKey("accessToken", IsAccessToken)
export const USER = new GGContextKey("user", IsUser)   // verified principal — the middleware sets this after verify

// server
const auth = new GGAuth({
  key: ACCESS_TOKEN, 
  user: USER, 
  toUser: (p) => ({id: p.subject as UserId, roles: p.permissions}), 
  secret: SECRET, 
  permission: IsEnum(Role), 
  store
})

// client (browser)
const session = new GGAuthSession({key: ACCESS_TOKEN, refresh: api.auth.refresh})
```

---

## 1. Use wire format in the API

```ts

const ACCESS_TOKEN_WIRE = GGHeader.middleware(ACCESS_TOKEN, {name: "authorization", scheme: "bearer"});

export const NoteApi = httpSchema(NoteApiContract)
  .pathPrefix("api/notes")
  .use(ACCESS_TOKEN_WIRE)
  .routes({…})

export const AuthApi = httpSchema(AuthApiContract)
  .pathPrefix("api/auth")
  .routes({login: …, refresh: …})

```

---

## 2. Server

One object owns the token kind end-to-end — mint, verify, rotate, and the middleware. `.useAuth(auth)` verifies `ACCESS_TOKEN` on every request and writes the principal into `USER`; handlers read `USER` directly, and only the login/refresh handlers touch the service.

```ts
import {GGAuth} from "@grest-ts/auth"
import {GGPasswordIdp} from "@grest-ts/auth/password"
import {ACCESS_TOKEN, USER} from "@yourapp/api/auth/token"

class AuthApiImpl {
  constructor(private auth: GGAuth<UserId, Role>, private users: UserStore, private idp: GGPasswordIdp) {}

  login = async ({email, password}: LoginInput) => {
    const user = await this.users.resolve(await this.idp.authenticate({username: email, password}))
    return await this.auth.issue(user.id, user.roles)        // → {accessToken, refreshToken, accessExpiresAt, …}
  }
  // rotates the refresh token AND re-derives the grant (a demotion lands on the next refresh)
  refresh = async ({refreshToken}: {refreshToken: string}) =>
    await this.auth.refresh(refreshToken, async (userId) => ({permissions: await this.users.rolesOf(userId)}))
}

class NoteApiImpl {
  list = async () => loadNotesFor(USER.get().id)   // no auth dep — read the verified principal off the key
}

export class AppRuntime extends GGRuntime {
  static readonly NAME = "app"
  protected compose(): void {
    const refreshTokenStore = new YouRefreshTokenStore()
    const auth = new GGAuth({
      key: ACCESS_TOKEN,
      user: USER,
      toUser: (p) => ({id: p.subject as UserId, roles: p.permissions}),   // verified wire payload → your principal, once
      secret: process.env.TOKEN_SECRET!,     // lib builds the signer; pass `signer` to use KMS instead
      permission: IsEnum(Role),              // or IsString for free-form scopes
      store: refreshTokenStore
    })
    const server = new GGHttpServer()
    const users = new UserStore(/* db */)

    new GGHttp(server)
      .http(AuthApi, new AuthApiImpl(auth, users, new GGPasswordIdp({lookup: users.byEmail})))   // public

    new GGHttp(server)
      .useAuth(auth)                                                                              // verify + permission gate
      .http(NoteApi, new NoteApiImpl())                                                           // protected
  }
}
```

`.useAuth(auth)` is the one call that wires verification (missing/invalid token → `NOT_AUTHORIZED`) **and** the per-route permission gate. The raw JWT `subject` appears only inside `toUser`, so handlers never see JWT jargon — they read a typed `User` off `USER.get()`. `secret` is your HMAC signing key — a `string` (or `() => string` to read a `GGSecret` lazily); `store` is **required** — refresh tokens must persist and stay revocable, so there's no in-memory default. **Defaults you don't pass:** 15-min access / 14-day refresh TTLs, the HMAC signer over `secret`, an `audience` derived from the token name. Override any in [Advanced](#advanced).

---

## 3. Client

```ts
import {GGAuthSession} from "@grest-ts/auth"       // browser entry of the same package
import {ACCESS_TOKEN} from "@yourapp/api/auth/token"

export const session = new GGAuthSession({
  key: ACCESS_TOKEN,
  refresh: api.auth.refresh,     // (refreshToken?) => TokenPair — your AuthApi client's refresh
})

await session.init()             // restore from storage on startup (refresh if expired)
session.start(await api.auth.login({email, password}))   // after your login screen
session.logout()                 // here and in every other tab
```

Then just use your API clients — the token is attached and kept fresh automatically:

```ts
await api.notes.list()           // if the token is stale, the call waits for one refresh, then goes out fresh
```

No transport, no interceptors, no `getAccessToken()` before calls. The session registers the token's freshness with the framework, so a request never leaves with a stale token — and a `401`/`403` that *does* come back is a genuine authorization error, not an expiry artifact.

---

## Storage

Two separate axes — don't conflate them:

- **The access token** always rides the `Authorization` header and lives in memory. That's the `GGContextKey` + its `header()` wire. Done.
- **The refresh credential** is the only thing with a storage choice:
  - **`localStorage` (default)** — the refresh token comes back in the refresh response and the client holds it.
  - **`cookie`** — the server issues it as an **httpOnly cookie scoped to the refresh endpoint**; the client never sees it. Here the cookie attributes (`httpOnly`, `path`, `sameSite`) are set **by the server when it writes the cookie** — they belong on the *service*, at issue-time, **not** in the api-level token definition:
    ```ts
    // server
    new GGAuth({key: ACCESS_TOKEN, user: USER, toUser: …, secret: SECRET, permission: …,
      refreshCookie: {name: "refresh", path: "/api/auth/refresh", sameSite: "strict"}})
    // client
    new GGAuthSession({key: ACCESS_TOKEN, refresh: api.auth.refresh, storage: "cookie"})
    ```

That's why the `GGContextKey` knows nothing about cookies: cookie details are a server-write concern, not a shared-contract one.

---

## Scoped ("derived") tokens — e.g. a tenant token

A second token kind, **access-only**, minted behind the user token. Per-tab on the client (different tabs → different tenants), switch-back cached. It follows the same two-key pattern as the primary token: a raw key for the wire, and a principal key written by the auth middleware.

```ts
// shared
export const TENANT_TOKEN      = new GGContextKey<string | undefined>("tenantToken", IsString.orUndefined)
export const TENANT_TOKEN_WIRE = header(TENANT_TOKEN, {name: "x-tenant-token"})
export const TENANT = new GGContextKey<TenantPrincipal>("tenant", IsTenant)   // verified tenant principal

// server: a second service — access-only by type, layered behind the user token
const tenant = new GGAuthDerived({key: TENANT_TOKEN, user: TENANT, toUser: (p) => ({id: p.subject, tenantId: p.tenantId}), secret: SECRET, permission: IsEnum(TenantRole)})

class TenantApiImpl {
  constructor(private auth: GGAuth<UserId, Role>, private tenant: GGAuthDerived<TenantPrincipal, TenantRole>, private members: MemberStore) {}
  selectTenant = async ({tenantId}: {tenantId: string}) => {
    const userId = USER.get().id                                               // read from context — no payload() call
    await this.members.assertMember(userId, tenantId)
    return await this.tenant.issueAccess(userId, await this.members.permsOf(userId, tenantId), {tenantId})
  }
}

// wiring
new GGHttp(server).useAuth(auth).http(TenantApi, new TenantApiImpl(auth, tenant, members))   // select: user token only
new GGHttp(server).useAuth(auth, tenant).http(TenantNoteApi, impl)                            // both; gate unions their permissions

// client
const session = new GGAuthSession({
  key: ACCESS_TOKEN,
  refresh: api.auth.refresh,
  derived: {tenant: {key: TENANT_TOKEN, mint: api.tenant.selectTenant}},   // mint → AccessOnly
})
await session.derived.tenant.select({tenantId})   // typed from `mint`; per-tab; switch-back cached
```

---

## Sockets

```ts
export const LiveApi = webSocketSchema(LiveContract).path("/live").use(ACCESS_TOKEN_WIRE).done()

await LiveApi.createClient({url: WS_URL}).connect()   // handshake auto-gated to a fresh token; reconnects too
```

For a raw, non-grest-ts socket needing the token in a URL: `await session.getAccessToken()`.

---

## Session state & UI

```ts
const s = useSyncExternalStore((cb) => session.subscribe(cb), () => session.getState())
if (s.status === "restoring")     return <Splash/>      // cold load
if (s.status !== "authenticated") return <Login/>       // anonymous / expired
return <App/>
```

`status` ∈ `anonymous | restoring | authenticated | expired` (+ `refreshing`/`degraded`). Block the UI on `restoring`/`expired`; leave children mounted during a brief `refreshing` so in-progress work survives.

---

## Advanced

Knobs you rarely touch — all defaulted, override only when you mean to:

**Server** — `signer` (KMS instead of `secret`), `accessTtlMs` / `refreshTtlMs`, `audience`, `refreshCookie` (cookie mode). Root `GGAuth` requires `store`; `GGAuthDerived` has none by type. Lower-level pieces (`GGAuthToken`, `GGAuthGuard`) still exist if you need to compose by hand.

**Client** — `storage` (`"localStorage"` | `"cookie"`), `refreshLeadMs` / `clockSkewMs`, `isFatalRefreshError`, `cacheKey`, `logout` (cookie mode: clear the cookie server-side).

---

## Why it stays clean

The app touches three things — a token, a server service, a client session — plus an IdP. Rotation, single-use replay protection, one-refresh-for-N-tabs, the per-request freshness gate, and the HTTP/WS wire are all behind those objects. If you find yourself constructing a signer, a guard, a transport, or reading a raw JWT claim, that's a leak — file it.
