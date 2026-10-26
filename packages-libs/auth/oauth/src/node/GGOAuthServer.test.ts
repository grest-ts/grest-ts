import {createECDH, createHash, generateKeyPairSync, hkdfSync, randomBytes, sign as cryptoSign} from "node:crypto"
import {importJWK, SignJWT} from "jose"
import {createServer} from "node:net"
import {GGRuntime} from "@grest-ts/runtime"
import {GGHeader, GGHttp, GGHttpSchema, GGHttpServer, GGRpc} from "@grest-ts/http"
import {GGContextKey} from "@grest-ts/context"
import {IsArray, IsObject, IsString, NOT_AUTHORIZED} from "@grest-ts/schema"
import {GGAuthAccessToken, HmacSigner, JwksVerifier, JwsSigningStrategy, type JwsSigner} from "@grest-ts/auth"
import {ACCESS_TOKEN_JWKS_PATH, GGOAuthServer, type GGOAuthResource} from "./GGOAuthServer"
import {InMemoryOAuthStore} from "./store/InMemoryOAuthStore"
import {GGOAuthResourceServer} from "./GGOAuthResourceServer"
import {GGOAuthServiceClient, GGOAuthTokenError} from "./GGOAuthServiceClient"
import {GGOAuthInteractionContract} from "../shared/interactionContract"

const IsClaims = IsObject({permissions: IsArray(IsString)})
type Claims = typeof IsClaims.infer

const port = await freePort()
const ISSUER = `http://localhost:${port}`
const API = `${ISSUER}/api`
const APP_LOGIN = "https://app.example/oauth-login"
const FIRST_PARTY_REDIRECT = "https://app.example/callback"
const IDENTITY_REDIRECT = "https://auth.example/access/callback"
const THIRD_PARTY_REDIRECT = "https://claude.ai/api/mcp/auth_callback"

// The app's existing first-party user token: OAuth must issue exactly this kind.
const userToken = new GGAuthAccessToken({signer: new HmacSigner("app-token-secret"), claimSchema: IsClaims, audience: "app-user"})
const userPermissions = new Map<string, string[] | undefined>([["alice", ["read", "write"]]])
// Set to make the next claims lookup fail as if the store/IdP were down.
let failClaimsOnce = false

const USER_WIRE = new GGHeader("authorization", {scheme: "bearer"})
const SUBJECT = new GGContextKey<{sub: string}>("oauthTestSubject", IsObject({sub: IsString}))
const USER_WIRE_HANDLER = USER_WIRE.define(() => ({
    process: async () => {
        const raw = USER_WIRE.get()
        if (!raw) throw new NOT_AUTHORIZED()
        SUBJECT.set({sub: (await userToken.verify(raw)).sub})
    },
}))
const InteractionApi = new GGHttpSchema({
    contract: GGOAuthInteractionContract,
    pathPrefix: "api/oauth/interaction",
    use: [USER_WIRE],
    routes: {get: GGRpc.GET("get"), approve: GGRpc.POST("approve"), deny: GGRpc.POST("deny")},
})

// Like a KMS key: it signs, but its private key never leaves it.
function sealedSigner(kid: string): JwsSigner {
    const {privateKey, publicKey} = generateKeyPairSync("ec", {namedCurve: "P-256"})
    return {
        alg: "ES256",
        kid: async () => kid,
        sign: async (input) => cryptoSign("sha256", input, {key: privateKey, dsaEncoding: "ieee-p1363"}),
        publicJwk: async () => ({...publicKey.export({format: "jwk"}), alg: "ES256", use: "sig", kid}),
    }
}

// A second resource, as for an MCP server: its own audience, tokens that grant no permissions, and an
// asymmetric signer the authorization server can't read the key of.
const MCP = `${ISSUER}/mcp`
const mcpToken = new GGAuthAccessToken({signer: new JwsSigningStrategy(sealedSigner("sealed-1")), claimSchema: IsClaims, audience: "app-mcp", issuer: () => ISSUER})
const mcp: GGOAuthResource<Claims> = {
    resource: () => MCP,
    accessToken: mcpToken,
    scopes: ["mcp"],
    claims: async (sub) => userPermissions.get(sub) ? {permissions: []} : undefined,
}
// The app's backend: a service client with its own resource, and the one that trades a user token
// for an org-scoped token (token exchange).
const INTERNAL = `${ISSUER}/internal`
const internalToken = new GGAuthAccessToken({signer: new HmacSigner("internal-secret"), claimSchema: IsClaims, audience: "app-internal"})
const ORG = `${ISSUER}/org`
const orgToken = new GGAuthAccessToken({signer: new JwsSigningStrategy(sealedSigner("sealed-org")), claimSchema: IsClaims, audience: "app-org"})
const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`

// What a client asks for: the first-party app its API, anyone else the MCP resource.
const target = (clientId: string) => clientId === "app" || clientId === "identity" ? {resource: API, scope: "api"} : {resource: MCP, scope: "mcp"}

let oauth!: GGOAuthServer
const store = new InMemoryOAuthStore()

class OAuthTestRuntime extends GGRuntime {
    public static readonly NAME = "oauth-test"

    protected compose(): void {
        const server = new GGHttpServer({port})
        USER_WIRE_HANDLER.create(undefined)
        oauth = new GGOAuthServer({
            issuer: () => ISSUER,
            store,
            secret: () => "oauth-test-secret",
            resources: [{
                resource: () => API,
                accessToken: userToken,
                scopes: ["api"],
                clients: "firstParty",
                claims: async (sub) => {
                    if (failClaimsOnce) {
                        failClaimsOnce = false
                        throw new Error("store unavailable")
                    }
                    const permissions = userPermissions.get(sub)
                    return permissions ? {permissions} : undefined
                },
            }, mcp, {
                resource: () => INTERNAL,
                accessToken: internalToken,
                scopes: ["internal"],
                clients: "service",
                claims: async (clientId) => clientId === "backend" ? {permissions: ["internal"]} : undefined,
            }, {
                resource: () => ORG,
                accessToken: orgToken,
                scopes: ["org"],
                clients: "firstParty",
                claims: async () => undefined,
                exchange: {
                    from: userToken,
                    params: ["org_id"],
                    claims: async (sub, params) => params.org_id === "o1" && userPermissions.get(sub) ? {permissions: ["org:" + sub]} : undefined,
                },
            }],
            serviceClients: () => [{clientId: "backend", secret: () => "backend-secret"}],
            interactionUrl: (uid) => `${APP_LOGIN}?uid=${uid}`,
            firstPartyClients: () => [
                {clientId: "app", name: "The App", redirectUris: [FIRST_PARTY_REDIRECT], postLogoutRedirectUris: ["https://app.example/"]},
                {clientId: "identity", name: "The App", redirectUris: [IDENTITY_REDIRECT], refreshTokens: false},
            ],
            dynamicRegistration: true,
            clientIdMetadataDocument: {allowedUrlPrefixes: () => ["https://clients.example/oauth/"]},
            proxy: true,
        })
        oauth.mount(server)
        oauth.protect(server, mcp, "/mcp", async (_req, res, token) => {
            res.writeHead(200, {"content-type": "application/json"})
            res.end(JSON.stringify({hello: token.sub}))
        })
        const unreachableKeys = {
            resource: () => `${ISSUER}/mcp-down`,
            accessToken: new GGAuthAccessToken({signer: new JwksVerifier({jwks: () => "http://127.0.0.1:1/jwks"}), claimSchema: IsClaims, audience: "app-mcp", issuer: () => ISSUER}),
            scopes: ["mcp"] as [string],
        }
        new GGOAuthResourceServer({authorizationServer: () => ISSUER, resources: [unreachableKeys]}).protect(server, unreachableKeys, "/mcp-down", async (_req, res) => {
            res.writeHead(200)
            res.end()
        })
        new GGHttp(server).http(InteractionApi, oauth.interactionApi(() => SUBJECT.get()!.sub))
    }
}

// A browser: keeps cookies, never follows redirects on its own.
class Browser {
    private readonly jar = new Map<string, string>()

    post(url: string, form: Record<string, string>): Promise<Response> {
        return this.get(url, {method: "POST", body: new URLSearchParams(form)})
    }

    async get(url: string, init: RequestInit = {}): Promise<Response> {
        const res = await fetch(new URL(url, ISSUER), {...init, redirect: "manual", headers: {...init.headers as Record<string, string>, ...(this.jar.size ? {cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ")} : {})}})
        for (const c of res.headers.getSetCookie()) {
            const [kv] = c.split(";")
            const i = kv.indexOf("=")
            this.jar.set(kv.slice(0, i), kv.slice(i + 1))
        }
        return res
    }

    // Follow redirects until one leaves the authorization server; returns that URL.
    async navigate(url: string): Promise<URL> {
        let next = new URL(url, ISSUER)
        while (next.origin === ISSUER) {
            const res = await this.get(next.href)
            if (res.status !== 303 && res.status !== 302) throw new Error(`${res.status} at ${next.href}: ${await res.text()}`)
            next = new URL(res.headers.get("location")!, ISSUER)
        }
        return next
    }
}

const pkce = () => {
    const verifier = randomBytes(32).toString("base64url")
    return {verifier, challenge: createHash("sha256").update(verifier).digest("base64url")}
}

function authorizeUrl(clientId: string, redirectUri: string, challenge: string, extra: Record<string, string> = {}): string {
    const url = new URL(`${ISSUER}/oauth/authorize`)
    url.search = new URLSearchParams({client_id: clientId, response_type: "code", redirect_uri: redirectUri, state: "st", code_challenge: challenge, code_challenge_method: "S256", ...target(clientId), ...extra}).toString()
    return url.href
}

async function token(body: Record<string, string>): Promise<Record<string, any>> {
    const res = await fetch(`${ISSUER}/oauth/token`, {method: "POST", body: new URLSearchParams(body)})
    return await res.json()
}

const interaction = (bearer: string) => async (method: "get" | "approve" | "deny", uid: string) => {
    const res = await fetch(`${API}/oauth/interaction/${method}${method === "get" ? `?uid=${uid}` : ""}`, {
        method: method === "get" ? "GET" : "POST",
        headers: {authorization: `Bearer ${bearer}`, ...(method === "get" ? {} : {"content-type": "application/json"})},
        body: method === "get" ? undefined : JSON.stringify({uid}),
    })
    const json = await res.json() as {success: boolean, data: any}
    return json
}

async function signIn(browser: Browser, clientId: string, redirectUri: string, sub = "alice", extra: Record<string, string> = {}) {
    const {verifier, challenge} = pkce()
    const login = await browser.navigate(authorizeUrl(clientId, redirectUri, challenge, extra))
    expect(login.origin + login.pathname).toBe(APP_LOGIN)
    const uid = login.searchParams.get("uid")!
    const call = interaction((await userToken.issue(sub, {permissions: []})).token)
    const details = await call("get", uid)
    const approved = await call("approve", uid)
    const callback = await browser.navigate(approved.data.redirectUrl)
    expect(callback.origin + callback.pathname).toBe(redirectUri)
    expect(callback.searchParams.get("iss")).toBe(ISSUER)
    const tokens = await token({grant_type: "authorization_code", code: callback.searchParams.get("code")!, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource: target(clientId).resource})
    return {details: details.data, tokens}
}

// A web client unless it only redirects to loopback (a CLI, which leaves application_type out).
async function register(redirectUris = [THIRD_PARTY_REDIRECT]): Promise<string> {
    const native = redirectUris.every(u => new URL(u).protocol === "http:")
    const res = await fetch(`${ISSUER}/oauth/register`, {
        method: "POST", headers: {"content-type": "application/json"},
        body: JSON.stringify({client_name: "Claude", redirect_uris: redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], ...(native ? {} : {application_type: "web"})}),
    })
    expect(res.status).toBe(201)
    return (await res.json()).client_id
}

describe("GGOAuthServer resources", () => {
    const base = {issuer: () => ISSUER, store: new InMemoryOAuthStore(), secret: () => "s", interactionUrl: () => "", scopes: ["x"] as [string]}
    const resource = (audience: string | undefined) => ({
        resource: () => `${ISSUER}/${audience ?? "none"}`,
        accessToken: new GGAuthAccessToken({signer: new HmacSigner("k"), claimSchema: IsClaims, audience}),
        scopes: ["x"] as [string],
        claims: async () => ({permissions: []}),
    })

    test("each resource needs its own audience (shared signer)", () => {
        expect(() => new GGOAuthServer({...base, resources: [resource("a"), resource(undefined)]})).toThrow(/own audience/)
        expect(() => new GGOAuthServer({...base, resources: [resource("a"), resource("a")]})).toThrow(/own audience/)
        expect(() => new GGOAuthServer({...base, resources: [resource("a"), resource("b")]})).not.toThrow()
    })
})

describe("GGOAuthServer", () => {
    let runtime: OAuthTestRuntime
    beforeAll(async () => { runtime = await new OAuthTestRuntime().start() })
    afterAll(async () => { await runtime.teardown() })
    beforeEach(() => { userPermissions.set("alice", ["read", "write"]) })

    test("names its endpoints as its metadata does", async () => {
        const meta = await (await fetch(`${ISSUER}/.well-known/oauth-authorization-server`)).json()
        expect(oauth.endpoints()).toEqual({authorization: meta.authorization_endpoint, token: meta.token_endpoint})
    })

    test("a protected resource answers 503, not invalid_token, when it can't fetch the keys", async () => {
        const {tokens} = await signIn(new Browser(), await register(), THIRD_PARTY_REDIRECT)
        const res = await fetch(`${ISSUER}/mcp-down`, {method: "POST", headers: {authorization: `Bearer ${tokens.access_token}`}})
        expect(res.status).toBe(503)
        expect(res.headers.get("www-authenticate")).toBeNull()
    })

    test("publishes RFC 8414 metadata with what MCP clients require", async () => {
        const meta = await (await fetch(`${ISSUER}/.well-known/oauth-authorization-server`)).json()
        expect(meta).toMatchObject({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/oauth/authorize`,
            token_endpoint: `${ISSUER}/oauth/token`,
            registration_endpoint: `${ISSUER}/oauth/register`,
            code_challenge_methods_supported: ["S256"],
            authorization_response_iss_parameter_supported: true,
            client_id_metadata_document_supported: true,
        })
        expect(meta.token_endpoint_auth_methods_supported).toContain("none")
        expect(meta.response_types_supported).toEqual(["code"])
        expect(meta.scopes_supported).toEqual(["openid", "offline_access", "api", "mcp", "internal", "org"])
        const jwks = await (await fetch(meta.jwks_uri)).json()
        // The ID-token key and the asymmetric resources' signers; HMAC resources publish nothing.
        expect(jwks.keys).toEqual([expect.objectContaining({kty: "EC", crv: "P-256", alg: "ES256"}), expect.objectContaining({kid: "sealed-1"}), expect.objectContaining({kid: "sealed-org"})])
        expect(jwks.keys.every((k: Record<string, unknown>) => k.d === undefined)).toBe(true)
    })

    test("first-party sign-in issues the app's own access token, then re-auths silently", async () => {
        const browser = new Browser()
        const {details, tokens} = await signIn(browser, "app", FIRST_PARTY_REDIRECT)
        expect(details.client).toMatchObject({clientId: "app", name: "The App", firstParty: true, redirectHosts: ["app.example"]})
        const verified = await userToken.verify(tokens.access_token)
        expect(verified.sub).toBe("alice")
        expect(verified.data).toEqual({permissions: ["read", "write"]})
        expect(tokens.refresh_token).toEqual(expect.any(String))

        const again = await browser.navigate(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge))
        expect(again.origin + again.pathname).toBe(FIRST_PARTY_REDIRECT)
        expect(again.searchParams.get("code")).toEqual(expect.any(String))
    })

    test("a first-party client without refresh tokens gets only an access token", async () => {
        const {tokens} = await signIn(new Browser(), "identity", IDENTITY_REDIRECT)
        expect((await userToken.verify(tokens.access_token)).sub).toBe("alice")
        expect(tokens.refresh_token).toBeUndefined()
    })

    test("prompt=login asks for a fresh sign-in even with a live session", async () => {
        const browser = new Browser()
        const first = await signIn(browser, "app", FIRST_PARTY_REDIRECT)
        expect(first.details.forceLogin).toBe(false)
        const forced = await signIn(browser, "app", FIRST_PARTY_REDIRECT, "alice", {prompt: "login"})
        expect(forced.details.forceLogin).toBe(true)
    })

    test("a forced login by another account ends the previous login session, then completes as the new account", async () => {
        userPermissions.set("bob", ["read"])
        const browser = new Browser()
        await signIn(browser, "app", FIRST_PARTY_REDIRECT)
        const {verifier, challenge} = pkce()
        const login = await browser.navigate(authorizeUrl("app", FIRST_PARTY_REDIRECT, challenge, {prompt: "login"}))
        const call = interaction((await userToken.issue("bob", {permissions: []})).token)
        const approved = await call("approve", login.searchParams.get("uid")!)
        // The server first ends alice's session with a self-submitting form; post it as a browser would.
        let res = await browser.get(approved.data.redirectUrl)
        while (res.status === 303) res = await browser.get(new URL(res.headers.get("location")!, ISSUER).href)
        const html = await res.text()
        const action = /action="([^"]+)"/.exec(html)![1]
        const fields = Object.fromEntries([...html.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map(m => [m[1], m[2]]))
        const confirmed = await browser.post(action, fields)
        const callback = await browser.navigate(new URL(confirmed.headers.get("location")!, ISSUER).href)
        expect(callback.origin + callback.pathname).toBe(FIRST_PARTY_REDIRECT)
        const tokens = await token({grant_type: "authorization_code", code: callback.searchParams.get("code")!, redirect_uri: FIRST_PARTY_REDIRECT, client_id: "app", code_verifier: verifier, resource: API})
        expect((await userToken.verify(tokens.access_token)).sub).toBe("bob")
    })

    test("third-party client registers, needs consent once, and gets a token only for its resource", async () => {
        const clientId = await register()
        const browser = new Browser()
        const {details, tokens} = await signIn(browser, clientId, THIRD_PARTY_REDIRECT)
        expect(details).toMatchObject({resource: MCP, client: {name: "Claude", firstParty: false, redirectHosts: ["claude.ai"], loopbackOnly: false}})
        expect((await mcpToken.verify(tokens.access_token)).data.permissions).toEqual([])
        await expect(userToken.verify(tokens.access_token)).rejects.toThrow()

        const again = await browser.navigate(authorizeUrl(clientId, THIRD_PARTY_REDIRECT, pkce().challenge))
        expect(again.searchParams.get("code")).toEqual(expect.any(String))

        expect(await oauth.listGrants("alice")).toEqual(expect.arrayContaining([
            expect.objectContaining({clientId, clientName: "Claude", firstParty: false}),
            expect.objectContaining({clientId: "app", firstParty: true}),
        ]))
    })

    test("a third-party client can't get a token for a first-party-only resource", async () => {
        const clientId = await register()
        const res = await new Browser().get(authorizeUrl(clientId, THIRD_PARTY_REDIRECT, pkce().challenge, {resource: API, scope: "api"}))
        expect(res.status).toBe(303)
        expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_target")
    })

    test("an asymmetric resource's token is signed by its own signer and verifies with only the published JWKS", async () => {
        const client = await register()
        const {tokens} = await signIn(new Browser(), client, THIRD_PARTY_REDIRECT)
        const header = JSON.parse(Buffer.from(tokens.access_token.split(".")[0], "base64url").toString())
        expect(header).toMatchObject({alg: "ES256", kid: "sealed-1", typ: "at+jwt"})

        const remote = new GGAuthAccessToken({signer: new JwksVerifier({jwks: () => `${ISSUER}${ACCESS_TOKEN_JWKS_PATH}`}), claimSchema: IsClaims, audience: "app-mcp", issuer: () => ISSUER})
        const verified = await remote.verify(tokens.access_token)
        expect(verified.sub).toBe("alice")
        expect(verified.data).toEqual({permissions: []})

        const jwks = await (await fetch(`${ISSUER}${ACCESS_TOKEN_JWKS_PATH}`)).json() as {keys: Array<Record<string, unknown>>}
        expect(jwks.keys.map(k => k.kid)).toEqual(["sealed-1", "sealed-org"])
        expect(jwks.keys.every(k => !("d" in k))).toBe(true)
    })

    test("an access token signed with the ID-token key (derived from the server secret) is refused by the access-token JWKS", async () => {
        const d = Buffer.from(hkdfSync("sha256", "oauth-test-secret", "", "@grest-ts/oauth es256", 32))
        const ecdh = createECDH("prime256v1")
        ecdh.setPrivateKey(d)
        const point = ecdh.getPublicKey()
        const jwk = {kty: "EC", crv: "P-256", d: d.toString("base64url"), x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url")}
        const published = await (await fetch(`${ISSUER}/oauth/jwks`)).json() as {keys: Array<Record<string, unknown>>}
        const kid = published.keys.find(k => k.x === jwk.x)?.kid as string
        expect(kid).toBeDefined()
        const forged = await new SignJWT({data: {permissions: ["admin"]}})
            .setProtectedHeader({alg: "ES256", kid, typ: "at+jwt"})
            .setSubject("mallory").setAudience("app-mcp").setIssuer(ISSUER).setIssuedAt().setExpirationTime("5m")
            .sign(await importJWK(jwk, "ES256"))

        const verifier = (jwks: string) => new GGAuthAccessToken({signer: new JwksVerifier({jwks: () => jwks}), claimSchema: IsClaims, audience: "app-mcp", issuer: () => ISSUER})
        expect((await verifier(`${ISSUER}/oauth/jwks`).verify(forged)).sub).toBe("mallory")
        await expect(verifier(`${ISSUER}${ACCESS_TOKEN_JWKS_PATH}`).verify(forged)).rejects.toBeInstanceOf(NOT_AUTHORIZED)
    })

    test("a protected resource challenges with its metadata, then serves a valid token", async () => {
        const anon = await fetch(MCP, {method: "POST"})
        expect(anon.status).toBe(401)
        expect(anon.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp", scope="mcp"`)
        const prm = await (await fetch(`${ISSUER}/.well-known/oauth-protected-resource/mcp`)).json()
        expect(prm).toEqual({resource: MCP, authorization_servers: [ISSUER], scopes_supported: ["mcp"], bearer_methods_supported: ["header"]})

        const app = await signIn(new Browser(), "app", FIRST_PARTY_REDIRECT)
        expect((await fetch(MCP, {method: "POST", headers: {authorization: `Bearer ${app.tokens.access_token}`}})).status).toBe(401)
        const {tokens} = await signIn(new Browser(), await register(), THIRD_PARTY_REDIRECT)
        expect(await (await fetch(MCP, {method: "POST", headers: {authorization: `Bearer ${tokens.access_token}`}})).json()).toEqual({hello: "alice"})
    })

    test("every resource publishes its metadata, so clients can find the authorization server from it", async () => {
        const api = await (await fetch(`${ISSUER}/.well-known/oauth-protected-resource/api`)).json()
        expect(api).toEqual({resource: API, authorization_servers: [ISSUER], scopes_supported: ["api"], bearer_methods_supported: ["header"]})
        expect((await fetch(`${ISSUER}/.well-known/oauth-protected-resource`)).status).toBe(404)
        expect((await fetch(`${ISSUER}/.well-known/oauth-protected-resource/other`)).status).toBe(404)
    })

    test("a loopback (CLI) client matches on any port and is asked for consent every time", async () => {
        const clientId = await register(["http://127.0.0.1/callback", "http://localhost/callback"])
        const login = await new Browser().navigate(authorizeUrl(clientId, "http://localhost:51234/callback", pkce().challenge))
        expect(login.origin + login.pathname).toBe(APP_LOGIN)
        const browser = new Browser()
        const {details} = await signIn(browser, clientId, "http://127.0.0.1:40123/callback")
        expect(details.client.loopbackOnly).toBe(true)
        // Any local process can claim a loopback redirect, so an existing grant isn't reused silently.
        const again = await browser.navigate(authorizeUrl(clientId, "http://127.0.0.1:40999/callback", pkce().challenge))
        expect(again.origin + again.pathname).toBe(APP_LOGIN)
    })

    test("client metadata documents are fetched only from allowed URL prefixes", async () => {
        for (const clientId of [
            "https://elsewhere.example/oauth/client.json",
            "https://clients.example/other/client.json",
            "https://clients.example/oauthx/client.json",
            "https://clients.example:8443/oauth/client.json",
            "https://user@clients.example/oauth/client.json",
        ]) {
            const res = await new Browser().get(authorizeUrl(clientId, THIRD_PARTY_REDIRECT, pkce().challenge))
            expect(res.status, clientId).toBe(400)
            expect(await res.text(), clientId).toContain("invalid_client")
        }
    })

    test("deny sends access_denied to the client", async () => {
        const clientId = await register()
        const browser = new Browser()
        const login = await browser.navigate(authorizeUrl(clientId, THIRD_PARTY_REDIRECT, pkce().challenge))
        const denied = await interaction((await userToken.issue("alice", {permissions: []})).token)("deny", login.searchParams.get("uid")!)
        const callback = await browser.navigate(denied.data.redirectUrl)
        expect(callback.searchParams.get("error")).toBe("access_denied")
    })

    test("an approval only completes in the browser that started the flow", async () => {
        const attacker = new Browser()
        const login = await attacker.navigate(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge))
        const approved = await interaction((await userToken.issue("alice", {permissions: []})).token)("approve", login.searchParams.get("uid")!)
        const victim = await new Browser().get(approved.data.redirectUrl)
        expect(victim.status).toBe(400)
        expect(await attacker.get(approved.data.redirectUrl).then(r => r.status)).toBe(400)
    })

    test("refresh rotates, re-resolves claims, and treats replay as reuse", async () => {
        const {tokens} = await signIn(new Browser(), "app", FIRST_PARTY_REDIRECT)
        userPermissions.set("alice", ["read"])
        const refreshed = await token({grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: "app"})
        expect((await userToken.verify(refreshed.access_token)).data.permissions).toEqual(["read"])
        expect(refreshed.refresh_token).not.toBe(tokens.refresh_token)

        expect((await token({grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: "app"})).error).toBe("invalid_grant")
        expect((await token({grant_type: "refresh_token", refresh_token: refreshed.refresh_token, client_id: "app"})).error).toBe("invalid_grant")
    })

    test("a grant records when it last got tokens", async () => {
        const clientId = await register()
        const before = Date.now()
        const {tokens} = await signIn(new Browser(), clientId, THIRD_PARTY_REDIRECT)
        const signedIn = Date.now()
        const lastUsed = async () => (await oauth.listGrants("alice")).find(g => g.clientId === clientId)!.lastUsedAt!
        const first = await lastUsed()
        expect(first).toBeGreaterThanOrEqual(before)
        expect(first).toBeLessThanOrEqual(signedIn)

        await new Promise(r => setTimeout(r, 5))
        expect((await token({grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId})).access_token).toEqual(expect.any(String))
        expect(await lastUsed()).toBeGreaterThan(first)
    })

    test("refresh fails once the subject is gone", async () => {
        const {tokens} = await signIn(new Browser(), "app", FIRST_PARTY_REDIRECT)
        userPermissions.set("alice", undefined)
        expect((await token({grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: "app"})).error).toBe("invalid_grant")
    })

    test("revoking a grant kills its refresh token; revokeAll ends the login session", async () => {
        const clientId = await register()
        const browser = new Browser()
        const {tokens} = await signIn(browser, clientId, THIRD_PARTY_REDIRECT)
        const grant = (await oauth.listGrants("alice")).find(g => g.clientId === clientId)!
        expect(await store.find("GrantUsage", grant.grantId)).toBeDefined()
        await oauth.revokeGrant("alice", grant.grantId)
        expect(await store.find("GrantUsage", grant.grantId)).toBeUndefined()
        expect((await token({grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId})).error).toBe("invalid_grant")
        expect((await oauth.listGrants("alice")).map(g => g.grantId)).not.toContain(grant.grantId)

        const appBrowser = new Browser()
        const app = await signIn(appBrowser, "app", FIRST_PARTY_REDIRECT)
        await oauth.revokeAll("alice")
        expect(await oauth.listGrants("alice")).toEqual([])
        expect((await token({grant_type: "refresh_token", refresh_token: app.tokens.refresh_token, client_id: "app"})).error).toBe("invalid_grant")
        const after = await appBrowser.navigate(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge))
        expect(after.origin + after.pathname).toBe(APP_LOGIN)
    })

    test("logout ends the login session, but not other apps' access", async () => {
        const browser = new Browser()
        await signIn(browser, "app", FIRST_PARTY_REDIRECT)
        const mcpClient = await register()
        const connected = await signIn(browser, mcpClient, THIRD_PARTY_REDIRECT)
        const logoutUrl = `/oauth/logout?client_id=app&post_logout_redirect_uri=${encodeURIComponent("https://app.example/")}`
        // Linked from any other page: the user must click to confirm.
        for (const referer of [undefined, "https://workspace.app.example/"]) {
            const linked = await (await browser.get(logoutUrl, {headers: referer ? {referer} : {}})).text()
            expect(linked).not.toContain("document.forms[0].submit()")
            expect(linked).toContain(`<button name="logout" value="yes">`)
        }
        const page = await (await browser.get(logoutUrl, {headers: {referer: "https://app.example/some/page"}})).text()
        expect(page).toContain("document.forms[0].submit()")
        const action = page.match(/action="([^"]+)"/)![1]
        const fields = Object.fromEntries([...page.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map(m => [m[1], m[2]]))
        expect(fields.logout).toBe("yes")
        const done = await browser.get(action, {method: "POST", headers: {"content-type": "application/x-www-form-urlencoded"}, body: new URLSearchParams(fields).toString()})
        expect(done.headers.get("location")).toBe("https://app.example/")

        const after = await browser.navigate(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge))
        expect(after.origin + after.pathname).toBe(APP_LOGIN)
        expect((await token({grant_type: "refresh_token", refresh_token: connected.tokens.refresh_token, client_id: mcpClient})).access_token).toEqual(expect.any(String))
    })

    test("an approval link never points at a host the request named itself", async () => {
        // A client can't set Host from fetch; X-Forwarded-Host (trusted behind a proxy) feeds the same value.
        const res = await fetch(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge), {redirect: "manual", headers: {"x-forwarded-host": "evil.example"}})
        const uid = new URL(res.headers.get("location")!, "https://evil.example").pathname.split("/").pop()!
        const approved = await interaction((await userToken.issue("alice", {permissions: []})).token)("approve", uid)
        expect(new URL(approved.data.redirectUrl).origin).toBe(ISSUER)

        const meta = await (await fetch(`${ISSUER}/.well-known/oauth-authorization-server`, {headers: {"x-forwarded-host": "evil.example"}})).json()
        expect(new URL(meta.token_endpoint).origin).toBe(ISSUER)
    })

    test("a refresh that fails before issuing (claims unavailable) can be retried", async () => {
        const {tokens} = await signIn(new Browser(), "app", FIRST_PARTY_REDIRECT)
        failClaimsOnce = true
        const failed = await fetch(`${ISSUER}/oauth/token`, {method: "POST", body: new URLSearchParams({grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: "app"})})
        expect(failed.status).toBe(500)
        expect((await token({grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: "app"})).access_token).toEqual(expect.any(String))
    })

    test("a refresh asking for a resource the token can't have fails without using the token up", async () => {
        const clientId = await register()
        const {tokens} = await signIn(new Browser(), clientId, THIRD_PARTY_REDIRECT)
        const wrong = await token({grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId, resource: API})
        expect(wrong.error).toBe("invalid_target")
        expect((await token({grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId})).access_token).toEqual(expect.any(String))
    })

    test("of two concurrent refreshes with one token, only one succeeds", async () => {
        const {tokens} = await signIn(new Browser(), "app", FIRST_PARTY_REDIRECT)
        const body = {grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: "app"}
        const results = await Promise.all([token(body), token(body)])
        // Never two live lineages from one token; the loser gets invalid_grant (not a retryable 5xx).
        expect(results.map(r => r.error ?? "ok").sort()).toEqual(["invalid_grant", "ok"])
    })

    test("a service client gets a token for its service-only resource with client_credentials", async () => {
        const res = await fetch(`${ISSUER}/oauth/token`, {method: "POST", headers: {authorization: basic("backend", "backend-secret")}, body: new URLSearchParams({grant_type: "client_credentials", resource: INTERNAL, scope: "internal"})})
        const body = await res.json()
        expect(res.status).toBe(200)
        const verified = await internalToken.verify(body.access_token)
        expect(verified.sub).toBe("backend")
        expect(verified.data).toEqual({permissions: ["internal"]})
    })

    test("client_credentials refuses a wrong secret and any resource that isn't service-only", async () => {
        const wrong = await fetch(`${ISSUER}/oauth/token`, {method: "POST", headers: {authorization: basic("backend", "nope")}, body: new URLSearchParams({grant_type: "client_credentials", resource: INTERNAL})})
        expect((await wrong.json()).error).toBe("invalid_client")
        const userApi = await fetch(`${ISSUER}/oauth/token`, {method: "POST", headers: {authorization: basic("backend", "backend-secret")}, body: new URLSearchParams({grant_type: "client_credentials", resource: API})})
        expect((await userApi.json()).error).toBe("invalid_target")
    })

    test("a registered (non-service) client can't use client_credentials", async () => {
        const res = await fetch(`${ISSUER}/oauth/register`, {
            method: "POST", headers: {"content-type": "application/json"},
            body: JSON.stringify({client_name: "Sneaky", redirect_uris: [THIRD_PARTY_REDIRECT], application_type: "web", token_endpoint_auth_method: "client_secret_basic", grant_types: ["authorization_code", "client_credentials"]}),
        })
        const {client_id, client_secret} = await res.json()
        // An app whose claims would happily answer for this subject: only the grant check stops it.
        userPermissions.set(client_id, ["read"])
        for (const resource of [undefined, MCP, INTERNAL]) {
            const body = await fetch(`${ISSUER}/oauth/token`, {method: "POST", headers: {authorization: basic(client_id, client_secret)}, body: new URLSearchParams({grant_type: "client_credentials", ...(resource ? {resource} : {})})}).then(r => r.json())
            expect(body.access_token).toBeUndefined()
            expect(body.error).toEqual(expect.any(String))
        }
    })

    test("a user can't get a service-only resource", async () => {
        const {challenge} = pkce()
        const res = await new Browser().get(authorizeUrl("app", FIRST_PARTY_REDIRECT, challenge, {resource: INTERNAL, scope: "internal"}))
        expect(res.headers.get("location") ?? "").toContain("error=invalid_target")
    })

    test("token exchange: the backend trades a user's token for an org token for the same user", async () => {
        const {tokens} = await signIn(new Browser(), "app", FIRST_PARTY_REDIRECT)
        const exchange = (params: Record<string, string>, auth = basic("backend", "backend-secret")) => fetch(`${ISSUER}/oauth/token`, {
            method: "POST", headers: {authorization: auth},
            body: new URLSearchParams({grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", subject_token_type: "urn:ietf:params:oauth:token-type:access_token", resource: ORG, ...params}),
        }).then(r => r.json())

        const ok = await exchange({subject_token: tokens.access_token, org_id: "o1"})
        expect(ok).toMatchObject({issued_token_type: "urn:ietf:params:oauth:token-type:access_token", token_type: "Bearer"})
        const verified = await orgToken.verify(ok.access_token)
        expect(verified.sub).toBe("alice")
        expect(verified.data).toEqual({permissions: ["org:alice"]})

        expect((await exchange({subject_token: tokens.access_token, org_id: "o2"})).error).toBe("invalid_grant")
        expect((await exchange({subject_token: "garbage", org_id: "o1"})).error).toBe("invalid_grant")
        expect((await exchange({subject_token: tokens.access_token, org_id: "o1", resource: MCP})).error).toBe("invalid_target")
        expect((await exchange({subject_token: tokens.access_token, org_id: "o1"}, basic("backend", "nope"))).error).toBe("invalid_client")
    })

    test("GGOAuthServiceClient: reuses its client_credentials token, exchanges, and reports token errors", async () => {
        const client = new GGOAuthServiceClient({tokenEndpoint: async () => `${ISSUER}/oauth/token`, clientId: "backend", secret: () => "backend-secret"})
        const [first, concurrent] = await Promise.all([client.token(INTERNAL), client.token(INTERNAL)])
        expect(concurrent).toBe(first)
        expect(await client.token(INTERNAL)).toBe(first)
        expect((await internalToken.verify(first)).sub).toBe("backend")

        const {tokens} = await signIn(new Browser(), "app", FIRST_PARTY_REDIRECT)
        const exchanged = await client.exchange(tokens.access_token, ORG, {org_id: "o1"})
        expect((await orgToken.verify(exchanged.token)).data).toEqual({permissions: ["org:alice"]})
        expect(exchanged.expiresAt).toBeGreaterThan(Date.now())

        const refused = await client.exchange(tokens.access_token, ORG, {org_id: "o2"}).catch((e: unknown) => e)
        expect(refused).toBeInstanceOf(GGOAuthTokenError)
        expect((refused as GGOAuthTokenError).error).toBe("invalid_grant")
        const wrongSecret = new GGOAuthServiceClient({tokenEndpoint: () => `${ISSUER}/oauth/token`, clientId: "backend", secret: () => "nope"})
        expect(await wrongSecret.token(INTERNAL).catch((e: GGOAuthTokenError) => e.error)).toBe("invalid_client")
    })

    test("a public client can't use token exchange", async () => {
        const {tokens} = await signIn(new Browser(), "app", FIRST_PARTY_REDIRECT)
        const body = await token({grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", client_id: "app", subject_token: tokens.access_token, subject_token_type: "urn:ietf:params:oauth:token-type:access_token", resource: ORG, org_id: "o1"})
        expect(body.access_token).toBeUndefined()
        expect(body.error).toEqual(expect.any(String))
    })

    test("the interaction API requires the app's signed-in user", async () => {
        const res = await fetch(`${API}/oauth/interaction/get?uid=x`)
        expect(res.status).toBe(401)
    })
})

async function freePort(): Promise<number> {
    return await new Promise((resolve) => {
        const s = createServer().listen(0, () => {
            const p = (s.address() as {port: number}).port
            s.close(() => resolve(p))
        })
    })
}
