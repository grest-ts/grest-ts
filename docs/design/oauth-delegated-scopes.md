# Delegated (OAuth) principals: method scopes + bearer challenges

Status: **proposal**. The driver is kratt's OAuth/MCP plan (`kratt/docs/plans/OAUTH.md`). It is
generic: any grest-ts app that lets a third party act for a user needs it.

## Problem

`permission:` answers "may this *user* do X". A token issued to a third-party client (an MCP
connector, a PAT) also has to answer "did the user let *this client* do X". Mapping OAuth
scopes onto permissions alone fails open. Most routes require a baseline permission that every
user holds (kratt has 113 `access`-only methods), so a token with *any* scope reaches all of
them. Delegation needs **default deny per method**, and that has to be declared on the
contract, which is the only place that knows the method.

## Proposal

**1. Contract: an optional `scope` per method** (same shape as `GGPermission`: string,
`anyOf`, `allOf`).

```ts
listAgents: {success: IsArray(IsAgent), errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
             permission: OrgPermission.access, scope: "agents:read"}
```

**2. Wire handler: optional `scopes()`**. It returns `undefined` for a full-trust principal
(first-party session) and `string[]` for a delegated one.

```ts
GG_USER_TOKEN.define(deps => ({process, permissions, scopes: async () => DelegationContext.get()?.scopes}))
```

**3. Gate** (`GGHttpPermissionsChecker`, and the websocket equivalent). After the permission
check:

| Case | Result |
|---|---|
| Any wire returns defined scopes and the method has no `scope` | `FORBIDDEN` |
| Any wire returns defined scopes and they don't satisfy `scope` | `FORBIDDEN` |
| Otherwise | Unchanged |

Full-trust callers are unaffected, so the change is backwards compatible.
`checkPermissionsAtStart` validates `scope` shapes like it does permissions.

**4. Bearer challenges** (RFC 6750 / RFC 9728). A wire may declare `challenge: {resourceMetadata,
scopeOf?}`:
- `NOT_AUTHORIZED` → `401` with `WWW-Authenticate: Bearer resource_metadata="…"`.
- A scope failure → `403` with `error="insufficient_scope", scope="<method scope>"`.

MCP clients (Claude, ChatGPT) require exactly this to start sign-in and step-up.

## Built since

- **The authorization server** is `@grest-ts/oauth` (`GGOAuthServer` on panva `oidc-provider`,
  `GGOAuthResourceServer`, `GGOAuthServiceClient`, `DynamoOAuthStore`).
- **Asymmetric signing** is in `@grest-ts/auth`: `JwsSigningStrategy` (ES256/EdDSA through a
  `JwsSigner`, which can be a KMS key) publishes its keys in the issuer's JWKS, and `JwksVerifier`
  verifies outside the issuing process with no key.

## Note

`HmacSigner`'s HKDF info string is `"@kratt/auth hs256 signing key"`, an app name inside the
framework. It is harmless (any constant works), but changing it invalidates every live token,
so leave it unless a key rotation happens anyway.
