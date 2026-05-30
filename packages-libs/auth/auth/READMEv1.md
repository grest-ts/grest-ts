# @grest-ts/auth

Access + refresh token auth for grest-ts — **server and client, HTTP and WebSocket** — all linked by a single context key. The server issues, verifies, and rotates tokens; the client keeps them fresh and attaches them automatically. You write no interceptors and no "is my token expired?" checks anywhere.

The whole design rests on one idea: **a token is a `GGContextKey`.** The same key is `.use()`d on your API contracts (so requests carry it), verified on the server, and kept fresh on the client. Nothing else has to know about tokens.

---

## 1. Define the token — once, shared by everyone

```ts
// auth/token.ts  — imported by your API package, your server, and your browser app
import {GGContextKey} from "@grest-ts/context"
import {header, type GGHeaderBinding} from "@grest-ts/http"
import {IsString} from "@grest-ts/schema"

const IsAccessToken = IsString.orUndefined.brand("AccessToken")

class MyAccessTokenContextKey extends GGContextKey<typeof IsAccessToken.infer> {

    public readonly wire: GGHeaderBinding;

    constructor() {
        super("access_token", IsAccessToken)
        this.wire = header(this, {name: "authorization", scheme: "bearer"});
    }
}

export const ACCESS_TOKEN = new MyAccessTokenContextKey()

```
---

## 2. API contracts — attach the wire

```ts

// @TODO Where is NoteApiContract and AuthApiContract ??

// api/NoteApi.ts  — protected: every route carries + verifies the token
export const NoteApi = httpSchema(NoteApiContract)
  .pathPrefix("api/notes")
  .use(ACCESS_TOKEN.wire)
  .routes({
    list: GGRpc.GET("list"), 
    create: GGRpc.POST("create")
  })

// api/AuthApi.ts  — PUBLIC: login + refresh carry no access token
export const IsTokenPair = IsObject({
  accessToken: IsString, 
  refreshToken: IsString, 
  accessExpiresAt: IsNumber,
  refreshExpiresAt: IsNumber
})
export const AuthApi = httpSchema(AuthApiContract)
  .pathPrefix("api/auth")
  .routes({
    login: GGRpc.POST("login"), 
    refresh: GGRpc.POST("refresh")
  })
```

---

## 3. Server — issue, refresh, verify

```ts
import {GGRuntime} from "@grest-ts/runtime"
import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {IsEnum} from "@grest-ts/schema"
import {AuthTokenService, HmacSigner, InMemoryRefreshTokenStore, GoogleIdp, type TokenPair} from "@grest-ts/auth"
import {PasswordIdp} from "@grest-ts/auth/password"        // optional peer dep: bcrypt
import {ACCESS_TOKEN} from "@yourapp/api/auth/token"
import {AuthApi, NoteApi, Role, IsUserId, type LoginInput} from "@yourapp/api"   // IsUserId = your branded user-id schema

// `users` / `UserStore` is YOUR store — it maps a verified identity → a user (id + roles).
// Every IdP returns the same `identity`, so the issue tail is identical for password and google.
class AuthApiImpl {
  constructor(
    private readonly auth: AuthTokenService<Role>,
    private readonly users: UserStore,
    private readonly password: PasswordIdp,
    private readonly google: GoogleIdp,
  ) {}

  login = async ({email, password}: LoginInput): Promise<TokenPair> => {
    const identity = await this.password.authenticate({username: email, password})
    const user = await this.users.resolve(identity)
    return await this.auth.issue(user.id, user.roles, {})    // → {accessToken, refreshToken, accessExpiresAt, ...}
  }

  loginGoogle = async ({idToken}: {idToken: string}): Promise<TokenPair> => {
    const identity = await this.google.authenticate(idToken)
    const user = await this.users.resolve(identity)
    return await this.auth.issue(user.id, user.roles, {})
  }

  // rotates the presented refresh token AND re-derives the grant (a demotion lands on the next refresh)
  refresh = async ({refreshToken}: {refreshToken: string}): Promise<TokenPair> =>
    await this.auth.refresh(refreshToken, async (userId) => ({permissions: await this.users.rolesOf(userId), claims: {}}))
}

class NoteApiImpl {
  constructor(private readonly auth: AuthTokenService<Role>) {}

  list = async () => {
    const userId = this.auth.payload().subject    // typed UserId — `subject` is whoever the token is about (here, the user)
    return await loadNotesFor(userId)
  }
}

export class AppRuntime extends GGRuntime {
  public static readonly NAME = "app"

  protected compose(): void {
    const server = new GGHttpServer()
    const users = new UserStore(/* your db */)

    // one object owns this token kind end-to-end — mint, verify, rotate, middleware — bound to ACCESS_TOKEN
    const auth = new AuthTokenService({
      key: ACCESS_TOKEN,
      subject: IsUserId,                             // the token's subject IS your user id — typed as UserId end-to-end
      signer: new HmacSigner(() => process.env.TOKEN_SECRET!),
      store: new InMemoryRefreshTokenStore(),        // swap a DB store in prod
      permission: IsEnum(Role),                      // or IsString for free-form scopes
      accessTtlMs: 15 * 60_000,                      // short-lived, stateless
      refreshTtlMs: 14 * 24 * 60 * 60_000,           // long-lived, revocable, single-use
    })

    // public chain — login + refresh carry no access token, so no guard
    new GGHttp(server)
      .http(AuthApi, new AuthApiImpl(
        auth, users,
        new PasswordIdp({lookup: (u) => users.byEmail(u)}),
        new GoogleIdp({clientId: process.env.GOOGLE_CLIENT_ID!}),
      ))

    // protected chain — verify the token, then gate each route on its permission
    new GGHttp(server)
      .use(auth.httpMiddleware())                  // missing/invalid token → NOT_AUTHORIZED
      .usePermissions(auth.permissionsResolver())  // per-route permission check
      .http(NoteApi, new NoteApiImpl(auth))
  }
}
```

> A token's **subject** is whatever it's about — usually a user, but possibly a service or device — so the library keeps the name generic. You declare what *yours* is with `subject: IsUserId`, so `auth.payload().subject` is typed `UserId`; bind it to a `userId` local in your handlers. (`subject` is just the full word for the JWT `sub` claim.)

Multiple token kinds (e.g. the tenant token in §6) compose at the gate — `usePermissions(scopeResolver([auth, tenantAuth]))` unions both kinds' permissions; `auth.permissionsResolver()` is just the single-kind shorthand.

---

## 4. Client — keep it fresh, automatically

```ts
import {AuthSession} from "@grest-ts/auth"           // browser entry of the same package
import {AuthApi, NoteApi} from "@yourapp/api"
import {ACCESS_TOKEN} from "@yourapp/api/auth/token"

const authClient = AuthApi.createClient({url})       // public — NOT wired to the session

export const session = new AuthSession({
  key: ACCESS_TOKEN,                                 // the SAME key → the session owns its freshness
  refresh: (rt) => authClient.refresh({refreshToken: rt}),   // returns the TokenPair as-is
  storage: "localStorage",                           // or "cookie" (refresh token in an httpOnly cookie)
})

await session.init()                                 // restore from storage on app start (refresh if expired)

// after your login screen:
const pair = await authClient.login({email, password})
session.start(pair)

// ...then just use your clients. Nothing else to wire:
const notes = NoteApi.createClient({url})
await notes.list()      // token attached automatically; if it's stale, the call waits for a refresh first

session.logout()        // clears it here and in every other tab
```

---

## 5. Sockets — same key, same story

```ts
export const LiveApi = webSocketSchema(LiveContract).path("/live").use(ACCESS_TOKEN.wire).done()

const socket = LiveApi.createClient({url: WS_URL})
await socket.connect()        // handshake gated to a fresh token; every reconnect re-gates too
```

For a **raw**, non-grest-ts socket that needs the token in a URL/query param, ask the session for it (this is the only place you ever do):

```ts
const url = `${RELAY}?token=${await session.getAccessToken()}`
```

---

## 6. Scoped ("derived") tokens — e.g. a tenant/org token

A second token kind — **access-only**, minted *behind* the user token. On the server it's just another `AuthTokenService` with no refresh store; on the client the session keeps a **per-tab** active selection (different tabs → different tenants), and switching back is cached.

**Define the token** — same shape as §1:
```ts
const IsTenantToken = IsString.orUndefined.brand("TenantToken")

class TenantTokenContextKey extends GGContextKey<typeof IsTenantToken.infer> {
    public readonly wire: GGHeaderBinding
    constructor() {
        super("tenant_token", IsTenantToken)
        this.wire = header(this, {name: "x-tenant-token"})
    }
}
export const TENANT_TOKEN = new TenantTokenContextKey()
```

**Contracts** — one route to *select* a tenant (mint the token, authed by the user token), plus tenant-scoped routes that carry it:
```ts
export const IsAccessOnly = IsObject({accessToken: IsString, accessExpiresAt: IsNumber})

// minting runs behind the USER token; returns a tenant ACCESS token (no refresh — re-minted on demand)
export const TenantApi = httpSchema(TenantApiContract).pathPrefix("api/tenant")
  .use(ACCESS_TOKEN.wire)
  .routes({selectTenant: GGRpc.POST("select")})

// routes acting on tenant resources carry both: who you are + which tenant
export const TenantNoteApi = httpSchema(TenantNoteContract).pathPrefix("api/tenant/notes")
  .use(ACCESS_TOKEN.wire)
  .use(TENANT_TOKEN.wire)
  .routes({list: GGRpc.GET("list")})
```

**Server** — a second, store-less service, and a `selectTenant` that issues it behind the user token:
```ts
class TenantApiImpl {
  constructor(
    private readonly auth: AuthTokenService<Role>,          // the user-token service from §3
    private readonly tenant: AuthTokenService<TenantRole>,
    private readonly members: MemberStore,
  ) {}

  selectTenant = async ({tenantId}: {tenantId: string}): Promise<AccessOnly> => {
    const userId = this.auth.payload().subject              // verified user id (this route runs behind the user guard)
    await this.members.assertMember(userId, tenantId)
    const perms = await this.members.permsOf(userId, tenantId)
    return await this.tenant.issueAccess(userId, perms, {tenantId})   // access-only: no refresh token minted
  }
}

// in compose(), alongside `auth` from §3:
const tenant = new AuthTokenService({
  key: TENANT_TOKEN,
  subject: IsUserId,                                        // issued for a user id, scoped to a tenant
  signer: new HmacSigner(() => process.env.TOKEN_SECRET!),  // same secret…
  audience: "tenant",                                       // …distinct audience, so a user token can't pass as a tenant one
  permission: IsEnum(TenantRole),
  accessTtlMs: 15 * 60_000,
  required: false,                                          // optional, layered behind the user token
})                                                          // no `store` / `refreshTtlMs` → access-only

// selecting a tenant: behind the user token only (you don't have a tenant token yet)
new GGHttp(server)
  .use(auth.httpMiddleware())
  .usePermissions(auth.permissionsResolver())
  .http(TenantApi, new TenantApiImpl(auth, tenant, members))

// tenant-scoped routes: both tokens verified; the gate sees the UNION of user + tenant permissions
new GGHttp(server)
  .use(auth.httpMiddleware())
  .use(tenant.httpMiddleware())
  .usePermissions(scopeResolver([auth, tenant]))
  .http(TenantNoteApi, new TenantNoteImpl(tenant))
```

**Client** — point the derived `mint` at `selectTenant`, then select per-tab:
```ts
const tenantClient = TenantApi.createClient({url})   // carries the user token automatically (it .use()s ACCESS_TOKEN.wire)

const session = new AuthSession({
  key: ACCESS_TOKEN,
  refresh: (rt) => authClient.refresh({refreshToken: rt}),
  derived: {
    tenant: {key: TENANT_TOKEN, mint: (p: {tenantId: string}) => tenantClient.selectTenant(p)},  // → AccessOnly
  },
})

await session.derived.tenant.select({tenantId})   // mints + attaches; typed from `mint`; per-tab; switch-back cached
session.derived.tenant.clear()
```

---

## 7. How freshness works

The session registers (in its constructor) a tiny controller per key with grest-ts's `GGContextKeySynchronizer` — you never call this yourself:

```
GGContextKeySynchronizer.provide(ACCESS_TOKEN, { isStale: () => expiringSoon(), recover: () => refresh() })
```

Before the framework reads a key to build a request or handshake, it `await`s `GGContextKeySynchronizer.waitFor(key)` — a no-op when fresh, a coalesced single refresh when stale. So:

- Requests only ever leave with a **known-fresh** token — the expiry race is closed, not patched after the fact.
- There's **nothing to attach per client** and nothing to forget — the gate rides the same wire as the token.
- A refresh in flight **holds** the few requests behind it (bounded, fail-fast) instead of letting them fail.

---

## 8. Session state & UI

`session.getState()` → `{status, refreshing, degraded}`, `status` ∈ `anonymous | restoring | authenticated | expired`. It's an external store:

```ts
const s = useSyncExternalStore((cb) => session.subscribe(cb), () => session.getState())
if (s.status === "restoring")     return <Splash/>      // cold load — nothing to lose
if (s.status !== "authenticated") return <Login/>       // anonymous / expired
return <App/>
```

Drive a blocking overlay off `restoring`/`expired`; leave children mounted during a brief `refreshing` so in-progress work survives.

---

## 9. Multi-tab & storage modes

- **`localStorage`** — refresh token + root access token are a shared cross-tab cache, so N tabs cost **one** refresh (serialized by a Web Lock so a single-use refresh token is never replayed). Scoped tokens stay per-tab.
- **`cookie`** — the refresh token lives in an httpOnly cookie scoped to the refresh endpoint; `refresh` is called with no argument and `logout` calls your server logout to clear it. Everything else is identical.

---

## Reference

**Server (`@grest-ts/auth`)** — `AuthToken` (`issue`/`refresh`/`verifyAccess`/`revoke`), `AuthGuard` + `scopeResolver`, `HmacSigner` / `SigningStrategy`, `RefreshTokenStore` / `InMemoryRefreshTokenStore`, IdPs (`PasswordIdp` via `/password`, `GoogleIdp`, `OidcIdp`, `OktaIdp`). Node-only (`jose`, `node:crypto`).

**Client (`@grest-ts/auth`, browser entry)** — `new AuthSession(config)`:
