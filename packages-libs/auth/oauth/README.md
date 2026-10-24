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

```ts
import {GGOAuthServer, InMemoryOAuthStore} from "@grest-ts/oauth"
import {DynamoOAuthStore} from "@grest-ts/oauth/dynamodb"

const oauth = new GGOAuthServer({
    issuer: () => config.issuerUrl.get(),          // public origin, no path
    resource: () => config.issuerUrl.get(),        // the API the tokens are for
    scopes: ["app"],                               // at least one; what they permit is up to you
    store: new DynamoOAuthStore(dynamo, "my-oauth"),
    secret: () => config.tokenSecret.reveal(),     // derives cookie + JWKS keys
    accessToken: userTokenEngine.access,           // your GGAuthAccessToken — signer must expose jwsKey()
    claims: async (subject) => claimsFor(subject), // at issue AND every refresh; undefined → invalid_grant
    interactionUrl: (uid) => `${appUrl}/?oauthLogin=${uid}`,
    firstPartyClients: () => [{clientId: "web", name: "My App", redirectUris: [`${appUrl}/oauth/callback`]}],
    dynamicRegistration: true,
    clientIdMetadataDocument: true,
})
oauth.mount(httpServer)                            // /oauth/* + /.well-known/*, announced to discovery
new GGHttp(httpServer).http(OAuthInteractionApi, oauth.interactionApi(() => USER.get()!.id))
```

`claims` is the `resolve` of `GGAuthRefreshToken.refresh`: role changes apply on the next refresh,
and a deleted or deactivated user's OAuth session ends there.

`listGrants(subject)` and `revokeGrant(subject, grantId)` back a "connected apps" page.
`revokeAll(subject)` is "log out everywhere"; call it next to `GGAuthRefreshToken.revokeAll`.

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

1. `get({uid})` returns the client (name, `firstParty`, redirect hosts, `loopbackOnly`) and the
   requested scopes.
2. For a first-party client, call `approve` right away. For any other client, show a consent
   screen first. Display the redirect hosts, and warn when `loopbackOnly` is set.
3. `approve`/`deny` return `redirectUrl` for the browser to follow. The result applies only in
   the browser holding the flow's interaction cookie, so a user approving someone else's flow
   can't hand them a code.

A first-party client re-authorizes silently while the login session lives.

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
    server: apiBase, clientId: "web", scope: "app",
    redirectUri: `${location.origin}/oauth/callback`, postLogoutRedirectUri: `${location.origin}/`,
    identity: (token) => toUser(decodeAccessToken(token)),   // session.get() data; UI-only, unverified
})
const session = GGAuthSession.withToken(USER_WIRE, {localStorageKey: "auth", refresh: oauth.refresh})

if (location.pathname === "/oauth/callback") session.start((await oauth.handleCallback(location.href)).result)
else if (!session.isLoggedIn()) await oauth.authorize({returnTo: location.pathname + location.search})

oauth.logout(undefined)   // ends the authorization server's login session too
```

- `iss` is checked against the issuer in the server's metadata.
- `resource` defaults to that issuer.
- `invalid_grant` on refresh surfaces as `NOT_AUTHORIZED`, which ends the session.

## Notes

- The issuer is an origin. Clients bind to it, so changing it disconnects them.
- Endpoints in the metadata follow the request host. Serve the issuer host directly or keep
  `Host` through your proxy, and pass `proxy: true` behind a TLS-terminating load balancer.
- oidc-provider's CIMD support is experimental (draft-02). The version is pinned exactly.
- The OAuth endpoints use the standard form-encoded protocol, not grest-ts contracts. That is the
  one place this package speaks raw HTTP.
