<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/oauth

Make a grest-ts app its own **OAuth 2.1 authorization server** with this package. The token a
client receives is your app's existing [`@grest-ts/auth`](../auth/README.md) access token: the same
signer, audience and claims. Your wires and per-route permissions work unchanged for OAuth
clients, whether that is your own SPA, an MCP connector (Claude, ChatGPT), a CLI or a script.

The protocol is [panva/oidc-provider](https://github.com/panva/node-oidc-provider)
(OpenID-certified). This package owns the grest-ts seams:

- mounting on a `GGHttpServer`
- storage
- token claims
- handing the login and consent pages to your own code

| What you get | |
|---|---|
| Authorization code + PKCE (S256 only, required) | No implicit/hybrid, no ROPC |
| Dynamic client registration (RFC 7591), Client ID Metadata Documents | Opt-in. CIMD is what MCP clients prefer |
| Resource indicators (RFC 8707), `iss` in responses (RFC 9207) | What the MCP authorization spec requires |
| Refresh rotation with reuse detection | Absolute lifetime: rotation never extends it |
| Revocation, RFC 8414 + OIDC discovery, RP-initiated logout | |

## Server

A server issues tokens for one or more **resources** (RFC 8707). Each resource has its own token
kind: audience, claims and TTL. A token for one resource is therefore rejected by another's wire.
Every resource must set its own `audience` (the constructor refuses otherwise): with a shared signer,
the audience is the only thing that tells the tokens apart.

```ts
import {GGOAuthServer, type GGOAuthResource} from "@grest-ts/oauth"
import {DynamoOAuthStore} from "@grest-ts/oauth/dynamodb"

// Your own app's API: its ordinary user token, only for your own clients.
const api: GGOAuthResource<UserClaims> = {
    resource: () => config.issuerUrl.get(),
    accessToken: userTokenEngine.access,           // GGAuthAccessToken on a TokenSigner (HMAC, private key, KMS)
    scopes: ["app"],                               // at least one; what they permit is up to you
    clients: "firstParty",                         // "any" (default) | "firstParty" | "service"
    claims: async (subject, client) => claimsFor(subject), // at issue AND every refresh; undefined → invalid_grant
}
// An MCP endpoint for other apps (Claude, ChatGPT…): own audience, its own (smaller) claims.
const mcp: GGOAuthResource<McpClaims> = {
    resource: () => `${config.issuerUrl.get()}/mcp`,   // exactly the URL users enter
    accessToken: mcpToken,                             // e.g. audience "app-mcp"
    scopes: ["mcp"],
    claims: async (subject) => ({permissions: []}),
}

const oauth = new GGOAuthServer({
    issuer: () => config.issuerUrl.get(),          // public origin, no path
    store: new DynamoOAuthStore(dynamo, "my-oauth"),
    secret: () => config.sessionSecret.reveal(),   // derives the cookie and ID-token keys
    resources: [api, mcp],                         // first = default for first-party clients
    interactionPage: renderSignIn,                 // your login and consent pages, below
    firstPartyClients: () => [{clientId: "web", name: "My App", redirectUris: [`${appUrl}/oauth/callback`]}],
    clientIdMetadataDocument: {allowedUrlPrefixes: () => ["https://claude.ai/oauth/", "https://chatgpt.com/oauth/"]},
    // dynamicRegistration: true,                  // open RFC 7591 registration — anyone, any name
})
oauth.mount(httpServer)                            // /oauth/* + /.well-known/* (incl. every resource's metadata), announced to discovery
oauth.protect(httpServer, mcp, "/mcp", handleMcp)  // 401 + resource metadata, then your handler
```

`claims` works like the `resolve` callback of `GGAuthRefreshToken.refresh`: role changes apply on
the next refresh, and a deleted or deactivated user's OAuth session ends there.

A user's access token carries `auth_time` (OIDC: when the user signed in, epoch seconds; a refresh
and a silent re-authorization keep it), read as `verify(token).auth_time`. To require a recent
sign-in, check it and send the user through `authorize({prompt: "login"})`. Token exchange keeps the
subject token's `auth_time`.

`clients` sets who may get tokens for a resource: `"any"` (the default: every client that signs a
user in), `"firstParty"` (only `firstPartyClients`) or `"service"` (only service clients, below). A
service client gets no other resource.

**Signing.** Each resource's token is signed through its own `accessToken.signer`. oidc-provider
can only sign with key material it holds, so it signs with a per-process placeholder and the token
endpoint re-signs the claims before the token leaves. That's what lets a signer keep its key in KMS.
Asymmetric signers (`JwsSigningStrategy`) publish their public keys at `ACCESS_TOKEN_JWKS_PATH`
(`/oauth/access-token-jwks`), so another service verifies with `JwksVerifier` and holds no key.
`/oauth/jwks` lists them too, next to the ID-token key derived from `secret`: never verify access
tokens against it, or whoever holds `secret` can mint them.

**Service clients** (`serviceClients`) are your own backends. `mount` also serves them a grest
contract, `GGOAuthServiceApi`, which they call with their secret:
- `token({resource})`, for resources with `clients: "service"`. The token's subject is the client id.
- `exchange({subjectToken, resource, params})`, for a resource with `exchange: {from, params, claims}`.
  The service sends a subject's valid `from` token plus your extra `params`, and gets a token for this
  resource for the same subject, e.g. an org-scoped token from a user token. Same subject only: the
  issued token doesn't say which service asked for it.

A wrong secret is `NOT_AUTHORIZED`; an invalid or expired subject token is `SUBJECT_TOKEN_INVALID`
(get a fresh one); a resource the client may not have, or no token for the subject, is `FORBIDDEN`. These are not OAuth grants: `/oauth/token` offers neither `client_credentials` nor token exchange.

```ts
const org: GGOAuthResource<OrgClaims> = {
    resource: () => `${issuer}/org`, accessToken: orgToken, scopes: ["org"], clients: "firstParty",
    claims: async () => undefined,                 // only issued by exchange
    exchange: {from: userToken, params: ["org_id"], claims: (sub, params) => orgClaimsFor(sub, params.org_id)},
}
```

A backend calls it through `GGOAuthServiceClient({clientId, secret, url?})`. `token(resource)` is reused
until shortly before it expires; `exchange(subjectToken, resource, params)` isn't cached. Without `url`
(or with an empty one) the server is found by service discovery, like any other contract. To send the
token, give the other service's client a wire value:

```ts
const auth = new GGOAuthServiceClient({clientId: "billing", secret: () => config.authSecret.reveal()})
const ledger = LedgerApi.createClient({wires: [{wire: SERVICE_TOKEN_WIRE, value: () => auth.token(LEDGER_RESOURCE)}]})
```

**Resource server only.** A service that accepts the tokens but doesn't run the authorization server
uses `GGOAuthResourceServer({authorizationServer, resources})`: `mount` serves each resource's RFC 9728
metadata and `protect` answers a missing or invalid token with the discovery challenge. Its resources'
`accessToken` only verifies: a `GGAuthAccessToken` on a `JwksVerifier` (from `@grest-ts/auth`) reading
the issuer's `/oauth/access-token-jwks`. `accessTokenJwksUrl(url?)` gives that URL: on `url`, or on the
server discovery finds for `GGOAuthServiceApi`, since `mount` serves both (`new JwksVerifier({jwks: accessTokenJwksUrl()})`).
When those keys can't be fetched (`JwksVerifier` throws `SERVER_ERROR`), `protect` answers 503 rather
than sending the client to sign in again.

`listGrants(subject)` and `revokeGrant(subject, grantId)` back a "connected apps" page. Each grant has `createdAt` and `lastUsedAt`: when it last got tokens, so within one access-token lifetime of its last use.
`revokeAll(subject)` is "log out everywhere"; call it next to `GGAuthRefreshToken.revokeAll`.

### Service tokens in tests

With `@grest-ts/oauth` installed, `GGTest` makes service-token calls work without setup:
- **The authorization server's runtime is running:** tokens are real, and the receiving service verifies them.
  The caller's `secret` and the server's `serviceClients` entry must be the same value in the test config;
  a mismatch is `NOT_AUTHORIZED`.
- **It isn't:** `GGOAuthServiceApi` answers with a random placeholder token that expires at once (so it's
  never reused). A mocked API accepts it (`OtherApi.mock.x` never checks credentials); a real one refuses it.
- **A test mocks `GGOAuthServiceApi.token`/`exchange` itself:** that mock answers while it is active.

Cached service tokens are dropped before each test, so a token from one test never answers the next.

### Protected resources (MCP)

`protect(server, resource, path, handler)` puts `path` behind the resource's token. It also
provides the discovery handshake MCP clients run:

- A request without a valid token gets `401 WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource{resource path}", scope="…"`.
- That metadata (RFC 9728) names this server and the resource's scopes. `mount` publishes it for
  every resource, protected or not, at the resource URL's path under that prefix.
- Your handler receives the verified token payload. For example, run the official MCP SDK's
  `StreamableHTTPServerTransport` on the raw `req`/`res`.

### Which clients may sign in

| Client | How it's known | Consent |
|---|---|---|
| First-party (`firstPartyClients`) | Pre-registered | None; silent while the login session lives |
| Client ID Metadata Document under `allowedUrlPrefixes` (https, default port) | `client_id` is its document URL, fetched by the server | Once per grant |
| Loopback / CLI (no `application_type` declared → native) | Any port on `localhost`/`127.0.0.1` matches | **Every** authorization: any local process could claim the redirect |
| Dynamic registration (opt-in) | `POST /oauth/register` | Once per grant |

### Login and consent pages

The authorization server signs the user in itself, on its own login session (an HttpOnly cookie on
the issuer). Your app is only an OAuth client: it never sees a password or approves anything.
`/oauth/authorize` sends the browser to `/oauth/interaction/:uid`, and every GET or POST under that
path (except `/complete`) goes to `interactionPage`:

```ts
const renderSignIn = async ({interaction, action, method, form, html, login, consent, deny}: GGOAuthInteractionRequest) => {
    if (method === "POST" && action === "password") {
        const user = await users.checkPassword(form.username, form.password)
        if (user) return login({accountId: user.id, amr: ["pwd"]})
    }
    if (method === "POST" && action === "consent") return form.allow ? consent() : deny()
    html(200, interaction.prompt === "login" ? loginForm() : consentForm(interaction))
}
```

- `interaction.prompt` is `"login"` (no login session, `prompt=login` or an expired `max_age`) or `"consent"`: a signed-in `accountId` approves a
  third-party client. Show the client's name and redirect hosts, and warn when `loopbackOnly` is set.
- A first-party client never gets a consent prompt: it re-authorizes silently while the login
  session lives (single sign-on).
- The request reaches your code only from the browser that started the flow (it holds the
  flow's interaction cookie: SameSite=Lax, scoped to the path). A POST must also come from the page's
  own origin (the browser's `Sec-Fetch-Site: same-origin`, or without it an `Origin` of the issuer) and be a form (`application/x-www-form-urlencoded`); the server answers 403 otherwise. Your pages can't be framed (`frame-ancestors 'none'`, `X-Frame-Options`).
  Don't send `Referrer-Policy: no-referrer` on them: browsers then post `Origin: null`, which is refused.
- `html(status, body)` and `redirect(url)` (a 303) answer with the headers these pages need:
  `text/html; charset=utf-8`, `Referrer-Policy: same-origin` and `Cache-Control: no-store`. `res` is
  there for anything else.
- Approve and deny only on a POST: a GET can be triggered by any page.
- `login` while a session for another account lives first ends that session (a self-submitting form).
- A sign-in that completes on another host (an external IdP's callback registered elsewhere) carries
  the uid through its own state and ends with `loginTicketUrl(uid, accountId)`: a single-use link
  that completes the flow only in the browser that started it. A failed one goes back to
  `interactionUrl(uid, error?)`, the flow's page; `error` (your own code) arrives as `?error=`.
  [External sign-in](#external-sign-in) does that round trip for you.
- `extraParams` pass authorization parameters through to `interaction.params` (e.g. a sign-in
  method to start right away: `authorize({params: {start_with: "sso"}})`).
- `sessionCookie` names the login session cookie. The default is `__Host-session` on an https issuer
  (`_session` on http). Browsers keep a `__Host-` cookie only over https, so name it yourself when an
  https issuer is also reached over http (e.g. a dev proxy on localhost).
- `errorPage(message)` renders the server's own error pages (an expired flow, an invalid request).
  `message` can echo request values (e.g. an OAuth `error_description`): HTML-escape it.

### External sign-in

"Sign in with GitHub / your company IdP" leaves the issuer: the upstream sends the browser back to a
callback registered on some host of yours. `externalSignIn` does that round trip: a per-flow state
cookie at start, and at the callback a login ticket or the flow's page with your error code.

```ts
const idpSignIn = oauth.externalSignIn<OidcAuthorizationChecks>({
    callbackPath: "/auth/oidc/callback", fallbackUrl: () => appUrl,
})
// GET /auth/oidc/start?uid=…  (your sign-in page links here)
idpSignIn.send(res, await idpSignIn.start(uid, async (state) => {
    const {url, checks} = await idp.authorize({state})     // OidcRelyingParty from @grest-ts/auth/oidc-rp
    return {url, data: checks}
}))
// GET /auth/oidc/callback
const redirect = await idpSignIn.callback(req, async ({params, query, data}) => {
    if (params.get("error")) return {error: "cancelled"}
    const {identity} = await idp.callback(query, data)
    const user = await users.byExternalIdentity(identity)
    return user ? {accountId: user.id, amr: ["idp"]} : {error: "not_linked"}
})
idpSignIn.send(res, redirect ?? {location: appUrl})
```

- `start(uid, authorize)`: `authorize` builds the upstream URL with the `state` it is given. The state
  cookie (HttpOnly, Secure, SameSite=Lax, `Path=callbackPath`, 10 minutes, named by the state so
  sign-ins in two tabs don't clash) carries the uid and your `data` (e.g. the PKCE verifier), signed
  with a key derived from `secret`. It is readable by the browser, so keep secrets out; over ~4 KB is refused.
- `callback(req, resolve)` is `undefined` when this browser holds no state cookie for the callback's
  `state`: it isn't this flow's, so a callback URL shared with something else (e.g. linking a GitHub
  account) falls through to your other handling. Otherwise the cookie is cleared, and:
  - a tampered or expired cookie, or a sign-in that expired meanwhile, goes to `fallbackUrl`;
  - `resolve` runs only after the cookie and `state` check out, so a forged `?error=` link can't cancel
    someone's sign-in. It answers `{accountId, amr?}` (→ a login ticket) or `{error}` (→
    `interactionUrl(uid, error)`). An exception propagates: map failures to an error code yourself.
- `send(res, redirect)` answers 302 with `Cache-Control: no-store` and the cookie.

A first-party client re-authorizes silently while the login session lives. Set `refreshTokens:
false` on one that only reads who signed in and keeps nothing: its codes then buy an access token alone.
`endpoints()` gives such a client its authorization and token URLs, and `listGrants` marks each grant
`firstParty`, so a "connected apps" list can leave your own clients out.

### Storage

`GGOAuthStore` is a small key/value interface over oidc-provider's models. Two implementations
ship:

- `InMemoryOAuthStore`: single process only (tests, local dev).
- `DynamoOAuthStore` (`@grest-ts/oauth/dynamodb`). Its table needs:
  - HASH key `pk` (S)
  - TTL attribute `expiresAtSec`
  - GSIs projecting ALL: `grantId-index`, `uid-index`, `accountId-index`
  - Rows are keyed by the SHA-256 of the id, and payloads drop it: oidc-provider's ids are the
    refresh tokens, codes and session cookies themselves, so the table holds none of them.

## Browser client

```ts
import {GGOAuthClient, decodeAccessToken} from "@grest-ts/oauth"

const oauth = new GGOAuthClient({
    resource: apiBase, clientId: "web", scope: "app",       // or `server: issuer` to name it directly
    redirectUri: `${location.origin}/oauth/callback`, postLogoutRedirectUri: `${location.origin}/`,
    identity: (token) => toUser(decodeAccessToken(token)),   // session.get() data; UI-only, unverified
})
const session = GGAuthSession.withToken(USER_WIRE, {localStorageKey: "auth", refresh: oauth.refresh})

if (oauth.isCallback(location.href)) session.start((await oauth.handleCallback(location.href)).result)
else if (!session.isLoggedIn()) await oauth.authorize({returnTo: location.pathname + location.search})

oauth.logout(undefined)   // ends the authorization server's login session too
```

- With only `resource`, the authorization server is the first one its RFC 9728 metadata names, so
  the sign-in host can differ from the API host (e.g. `auth.` vs `api.`). The metadata must be for
  exactly that resource.
- A discovered server's metadata must declare it as the issuer (RFC 8414).
- With `server`, its metadata is used as fetched (e.g. the issuer reached through a dev proxy), and
  `resource` defaults to the issuer it declares. It may be a function, looked up once (e.g. read from
  the API's RFC 9728 metadata when the dev proxy's origin isn't the resource's).
- `iss` on the callback is required and must match the issuer (RFC 9207).
- Each sign-in in progress is kept in `sessionStorage` under its own `state`, so sign-ins started in
  two tabs at once both complete.
- `invalid_grant` on refresh surfaces as `NOT_AUTHORIZED`, which ends the session.
- `authorize({prompt: "login"})` asks for a fresh sign-in even while the login session lives;
  `authorize({params})` adds the server's `extraParams`.

## Headless sign-in (scripts, tests)

`GGOAuthHeadlessBrowser` signs in the way a browser does, without one: authorization code + PKCE, a
cookie jar, redirects followed by hand, self-submitting forms submitted, and form POSTs carrying the
issuer's `Origin`. It stops on your sign-in pages and asks you how to answer each.

```ts
import {GGOAuthHeadlessBrowser} from "@grest-ts/oauth"

const browser = new GGOAuthHeadlessBrowser({server: authUrl})
const tokens = await browser.signIn({clientId: "web", redirectUri: `${appUrl}/oauth/callback`, scope: "app"}, (page) =>
    page.html.includes("/consent") ? {action: "consent", form: {allow: "1"}} : {action: "password", form: {username, password}})
api.createClient({wires: [{wire: USER_TOKEN_WIRE, value: () => tokens.accessToken}]})
```

- `signIn(client, answer)`: `answer(page)` gets each sign-in page (`url`, `uid`, `status`, `html`) and
  returns the `action` to POST to and its `form`. The flow ends at the client's redirect URI; `iss` is
  checked and the code redeemed (`{accessToken, refreshToken?, idToken?, expiresAt}`). An error there
  throws `GGOAuthTokenError` (`access_denied` when the user denied); a page it can't answer throws.
- Step by step: `authorize(client)` returns the first `step` and `finish(location)`; `submit(page, action,
  form)` and `follow(url)` return the next step, whose `location` is set once the flow leaves the
  server's origins (e.g. to an upstream sign-in). `get`, `post` and `cookies` are there for the rest.
- `client.params` adds authorization parameters (`prompt`, your `extraParams`). Reusing a browser keeps
  its login session: the next sign-in is silent.
- `origins` lists more hosts whose redirects are followed (e.g. where an external sign-in starts), and
  `fetch` replaces the transport (e.g. to reach a configured issuer at a test server's real address).
- The cookie jar keys cookies by name only: one server at a time.

## Notes

- The issuer, first-party clients, keys and resources are handed to oidc-provider when the first
  OAuth request arrives. Changing them takes a restart; `allowedUrlPrefixes` is read on every fetch.
- Sign-in happens on the issuer's origin: a login ticket always points there (request hosts are
  client-controlled). A flow reached on another origin of the server (e.g. localhost behind a router)
  works only in browsers that send `Sec-Fetch-Site`.
- The issuer is an origin. Clients bind to it, so changing it disconnects them.
- Resource metadata is served by the resource URL's path on any host, so give each resource its
  own path (e.g. the API at `/` and MCP at `/mcp`).
- Endpoints in the metadata follow the request host. Serve the issuer host directly or keep
  `Host` through your proxy, and pass `proxy: true` behind a TLS-terminating load balancer (it trusts
  `X-Forwarded-Proto`; `X-Forwarded-Host` is always ignored — clients can send it).
- oidc-provider's CIMD support is experimental (draft-02). The version is pinned exactly.
- The OAuth endpoints use the standard form-encoded protocol, not grest-ts contracts. That is the
  one place this package speaks raw HTTP.
