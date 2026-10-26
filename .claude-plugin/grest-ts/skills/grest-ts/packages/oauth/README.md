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
- handing login and consent to your own UI

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
    accessToken: userTokenEngine.access,           // GGAuthAccessToken — signer must expose jwsKey()
    scopes: ["app"],                               // at least one; what they permit is up to you
    firstPartyOnly: true,
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
    secret: () => config.tokenSecret.reveal(),     // derives cookie + JWKS keys
    resources: [api, mcp],                         // first = default for first-party clients
    interactionUrl: (uid, {firstParty, redirectUri}) => `${appUrl}/?oauthLogin=${uid}`,
    firstPartyClients: () => [{clientId: "web", name: "My App", redirectUris: [`${appUrl}/oauth/callback`]}],
    clientIdMetadataDocument: {allowedUrlPrefixes: () => ["https://claude.ai/oauth/", "https://chatgpt.com/oauth/"]},
    // dynamicRegistration: true,                  // open RFC 7591 registration — anyone, any name
})
oauth.mount(httpServer)                            // /oauth/* + /.well-known/* (incl. every resource's metadata), announced to discovery
oauth.protect(httpServer, mcp, "/mcp", handleMcp)  // 401 + resource metadata, then your handler
new GGHttp(httpServer).http(OAuthInteractionApi, oauth.interactionApi(() => USER.get()!.id))
```

`claims` works like the `resolve` callback of `GGAuthRefreshToken.refresh`: role changes apply on
the next refresh, and a deleted or deactivated user's OAuth session ends there.

`listGrants(subject)` and `revokeGrant(subject, grantId)` back a "connected apps" page.
`revokeAll(subject)` is "log out everywhere"; call it next to `GGAuthRefreshToken.revokeAll`.

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

### Login and consent stay in your app

`/oauth/authorize` sends the browser to `interactionUrl(uid)`. That page uses your normal login,
then calls `GGOAuthInteractionContract`. Bind the contract with **your** user wire, so the
signed-in user becomes the OAuth subject:

```ts
export const OAuthInteractionApi = new GGHttpSchema({
    contract: GGOAuthInteractionContract, pathPrefix: "api/oauth/interaction", use: [USER_WIRE],
    routes: {get: GGRpc.GET("get"), approve: GGRpc.POST("approve"), deny: GGRpc.POST("deny")},
})
```

The page works like this:

1. `get({uid})` returns the client (name, `firstParty`, redirect hosts, `loopbackOnly`), the
   requested scopes and `forceLogin`.
2. When `forceLogin` is set (the client sent `prompt=login`, or its `max_age` has passed), sign the
   user out of your app first and show the login form: an existing session must not approve it.
3. For a first-party client, call `approve` right away. For any other client, show a consent
   screen first. Display the redirect hosts, and warn when `loopbackOnly` is set.
4. `approve`/`deny` return `redirectUrl` for the browser to follow. The result applies only in
   the browser holding the flow's interaction cookie, so a user approving someone else's flow
   can't hand them a code.

A first-party client re-authorizes silently while the login session lives. Set `refreshTokens:
false` on one that only reads who signed in and keeps nothing: its codes then buy an access token alone.

### Storage

`GGOAuthStore` is a small key/value interface over oidc-provider's models. Two implementations
ship:

- `InMemoryOAuthStore`: single process only (tests, local dev).
- `DynamoOAuthStore` (`@grest-ts/oauth/dynamodb`). Its table needs:
  - HASH key `pk` (S)
  - TTL attribute `expiresAtSec`
  - GSIs projecting ALL: `grantId-index`, `uid-index`, `accountId-index`

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
- With `server`, its metadata is used as fetched (it may be the issuer reached on another of its
  `origins`), and `resource` defaults to the issuer it declares.
- `iss` on the callback must match the issuer (RFC 9207).
- `invalid_grant` on refresh surfaces as `NOT_AUTHORIZED`, which ends the session.

## Notes

- The issuer, first-party clients, keys and resources are handed to oidc-provider when the first
  OAuth request arrives. Changing them takes a restart; `allowedUrlPrefixes` is read on every fetch.
- A sign-in finishes on the origin it started on only if that is the issuer or one of `origins`.
  Request hosts are client-controlled, so anything else falls back to the issuer.
- The issuer is an origin. Clients bind to it, so changing it disconnects them.
- Resource metadata is served by the resource URL's path on any host, so give each resource its
  own path (e.g. the API at `/` and MCP at `/mcp`).
- Endpoints in the metadata follow the request host. Serve the issuer host directly or keep
  `Host` through your proxy, and pass `proxy: true` behind a TLS-terminating load balancer (it trusts
  `X-Forwarded-Proto`; `X-Forwarded-Host` is always ignored — clients can send it).
- oidc-provider's CIMD support is experimental (draft-02). The version is pinned exactly.
- The OAuth endpoints use the standard form-encoded protocol, not grest-ts contracts. That is the
  one place this package speaks raw HTTP.
