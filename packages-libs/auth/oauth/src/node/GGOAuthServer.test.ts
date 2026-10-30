import {createHash, generateKeyPairSync, randomBytes, sign as cryptoSign} from "node:crypto"
import {importJWK, SignJWT} from "jose"
import {createServer} from "node:net"
import {GGRuntime} from "@grest-ts/runtime"
import {GGHttpServer} from "@grest-ts/http"
import {FORBIDDEN, IsArray, IsObject, IsString, NOT_AUTHORIZED} from "@grest-ts/schema"
import {GGAuthAccessToken, HmacSigner, JwksVerifier, JwsSigningStrategy, type JwsSigner} from "@grest-ts/auth"
import {ACCESS_TOKEN_JWKS_PATH, deriveEs256Jwk, GGOAuthServer, type GGOAuthInteraction, type GGOAuthResource} from "./GGOAuthServer"
import type {GGDynamoDb} from "@grest-ts/db-dynamodb"
import {InMemoryOAuthStore} from "./store/InMemoryOAuthStore"
import {DynamoOAuthStore} from "./store/DynamoOAuthStore"
import {GGOAuthResourceServer} from "./GGOAuthResourceServer"
import {GGOAuthServiceClient} from "./GGOAuthServiceClient"
import {SUBJECT_TOKEN_INVALID} from "./GGOAuthServiceApi"
import type {GGOAuthExternalSignIn} from "./GGOAuthExternalSignIn"
import {GGOAuthHeadlessBrowser, type GGOAuthHeadlessStep} from "./GGOAuthHeadlessBrowser"

const IsClaims = IsObject({permissions: IsArray(IsString)})
type Claims = typeof IsClaims.infer

const port = await freePort()
const ISSUER = `http://localhost:${port}`
const tlsPort = await freePort()
const TLS_ISSUER = `https://localhost:${tlsPort}`
const API = `${ISSUER}/api`
const SESSION_COOKIE = "app_session"
const FIRST_PARTY_REDIRECT = "https://app.example/callback"
const IDENTITY_REDIRECT = "https://auth.example/access/callback"
const THIRD_PARTY_REDIRECT = "https://claude.ai/api/mcp/auth_callback"

// The app's existing first-party user token: OAuth must issue exactly this kind.
const userToken = new GGAuthAccessToken({signer: new HmacSigner("app-token-secret"), claimSchema: IsClaims, audience: "app-user"})
const userPermissions = new Map<string, string[] | undefined>([["alice", ["read", "write"]]])
// Set to make the next claims lookup fail as if the store/IdP were down.
let failClaimsOnce = false


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
const APP = {clientId: "app", redirectUri: FIRST_PARTY_REDIRECT, ...target("app")}

let oauth!: GGOAuthServer
// A sign-in on an upstream (as an OIDC IdP or GitHub) whose callback is this server's /ext/callback.
let external!: GGOAuthExternalSignIn<{nonce: string}>
const UPSTREAM = "https://upstream.example"
// Every bearer value the tests saw: tokens, codes, approval tickets and the login session cookie.
const bearers = new Set<string>()

// DynamoDB as DynamoOAuthStore uses it: key lookups, the GSIs it queries, and its one put condition.
function fakeDynamo() {
    const rows = new Map<string, Record<string, unknown>>()
    const query = async (_table: string, index: string, _condition: string, {":model": model, ...key}: Record<string, unknown>) =>
        [...rows.values()].filter(r => r[index.replace("-index", "")] === Object.values(key)[0] && (!model || r.model === model))
    const db = {
        get: async (_table: string, key: {pk: string}) => {
            const row = rows.get(key.pk)
            if (fake.slowReads) await new Promise(r => setTimeout(r, 20))
            return row
        },
        put: async (_table: string, item: {pk: string}) => { rows.set(item.pk, item) },
        putConditional: async (_table: string, item: {pk: string}) => {
            const row = rows.get(item.pk)
            if (!row || row.consumedAt !== undefined) return false
            rows.set(item.pk, item)
            return true
        },
        delete: async (_table: string, key: {pk: string}) => { rows.delete(key.pk) },
        query,
        queryPage: async (...args: Parameters<typeof query>) => ({items: await query(...args), cursor: undefined}),
    }
    const fake = {db: db as unknown as GGDynamoDb, rows, slowReads: false}
    return fake
}
const dynamo = fakeDynamo()
const store = new DynamoOAuthStore(dynamo.db, "oauth")

class OAuthTestRuntime extends GGRuntime {
    public static readonly NAME = "oauth-test"

    protected compose(): void {
        const server = new GGHttpServer({port})
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
            // The app's sign-in pages, reduced to what a test drives: the page as JSON, and a "login" that trusts the posted subject.
            interactionPage: async ({res, method, action, form, interaction, login, consent, deny, html, redirect}) => {
                if (action === "html") return html(200, "<p>page</p>")
                if (action === "redirect") return redirect("https://elsewhere.example/")
                if (method === "GET") {
                    res.writeHead(200, {"content-type": "application/json"})
                    res.end(JSON.stringify({interaction}))
                    return
                }
                if (action === "login") return login({accountId: form.sub})
                if (action === "consent") return consent()
                if (action === "deny") return deny()
                res.writeHead(404)
                res.end()
            },
            errorPage: (message) => `<p>${message}</p>`,
            extraParams: ["start_with"],
            sessionCookie: () => SESSION_COOKIE,
            firstPartyClients: () => [
                {clientId: "app", name: "The App", redirectUris: [FIRST_PARTY_REDIRECT], postLogoutRedirectUris: ["https://app.example/"]},
                {clientId: "identity", name: "The App", redirectUris: [IDENTITY_REDIRECT], refreshTokens: false},
            ],
            dynamicRegistration: true,
            clientIdMetadataDocument: {allowedUrlPrefixes: () => ["https://clients.example/oauth/"]},
            proxy: true,
        })
        oauth.mount(server)
        external = oauth.externalSignIn({callbackPath: "/ext/callback", fallbackUrl: () => `${ISSUER}/fallback`})
        server.registerRoute("GET", "/ext/start", async (req, res) => {
            const uid = new URL(req.url!, ISSUER).searchParams.get("uid")!
            external.send(res, await external.start(uid, async (state) => ({url: `${UPSTREAM}/authorize?state=${state}`, data: {nonce: "n1"}})))
        })
        server.registerRoute("GET", "/ext/callback", async (req, res) => {
            const redirect = await external.callback(req, async ({params, data}) => {
                if (params.get("error")) return {error: "cancelled"}
                if (data.nonce !== "n1") return {error: "lost data"}
                return {accountId: params.get("code")!, amr: ["ext"]}
            })
            if (redirect) return external.send(res, redirect)
            // A shared callback URL's other use (e.g. linking an account).
            res.writeHead(200)
            res.end("not a sign-in")
        })
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
    }
}

// An https issuer, served as behind a TLS-terminating proxy.
class TlsTestRuntime extends GGRuntime {
    public static readonly NAME = "oauth-tls-test"

    protected compose(): void {
        new GGOAuthServer({
            issuer: () => TLS_ISSUER,
            store: new InMemoryOAuthStore(),
            secret: () => "tls-secret",
            resources: [{resource: () => `${TLS_ISSUER}/api`, accessToken: userToken, scopes: ["api"], claims: async () => ({permissions: []})}],
            interactionPage: async ({method, form, login, html}) => method === "POST" ? login({accountId: form.sub}) : html(200, "<form></form>"),
            firstPartyClients: () => [{clientId: "app", name: "The App", redirectUris: [FIRST_PARTY_REDIRECT]}],
            proxy: true,
        }).mount(new GGHttpServer({port: tlsPort}))
    }
}

type Page = GGOAuthHeadlessStep & {uid: string, interaction: GGOAuthInteraction}

// fetch, noting every Set-Cookie and the bearer values the tests see: the login session cookie, codes and tokens.
const recording = (setCookies: string[]): typeof fetch => async (input, init) => {
    const res = await fetch(input, init)
    for (const c of res.headers.getSetCookie()) {
        setCookies.push(c)
        const [name, value] = c.split(";")[0].split("=")
        if (name === SESSION_COOKIE && value) bearers.add(value)
    }
    if (String(input).endsWith("/oauth/token")) {
        const json = await res.clone().json()
        for (const value of [new URLSearchParams(String(init?.body)).get("code"), json.access_token, json.refresh_token]) if (value) bearers.add(value)
    }
    return res
}

// The app's sign-in pages answer GET with the interaction as JSON.
class Browser extends GGOAuthHeadlessBrowser {
    readonly setCookies: string[]

    constructor(setCookies: string[] = []) {
        super({server: ISSUER, fetch: recording(setCookies)})
        this.setCookies = setCookies
    }

    // The sign-in page the flow stops on.
    async page(at: string | Promise<GGOAuthHeadlessStep>): Promise<Page> {
        const step = await (typeof at === "string" ? this.follow(at) : at)
        if (step.location || !step.uid || step.status !== 200) throw new Error(`no sign-in page: ${step.status} at ${step.location ?? step.url}: ${step.html}`)
        return {...step, uid: step.uid, interaction: JSON.parse(step.html).interaction}
    }

    // Where the flow leaves the authorization server.
    async done(at: string | Promise<GGOAuthHeadlessStep>): Promise<URL> {
        const step = await (typeof at === "string" ? this.follow(at) : at)
        if (!step.location) throw new Error(`stopped at ${step.url}: ${step.status} ${step.html}`)
        return step.location
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
    const json = await res.json()
    for (const value of [body.code, json.access_token, json.refresh_token]) if (value) bearers.add(value)
    return json
}

// Signs in as `sub` on every login page and approves every consent page; returns the pages seen.
async function signIn(browser: Browser, clientId: string, redirectUri: string, sub = "alice", params: Record<string, string> = {}) {
    const pages: GGOAuthInteraction[] = []
    const tokens = await browser.signIn({clientId, redirectUri, ...target(clientId), params}, (page) => {
        const {interaction} = JSON.parse(page.html) as {interaction: GGOAuthInteraction}
        pages.push(interaction)
        return {action: interaction.prompt === "login" ? "login" : "consent", form: {sub}}
    })
    return {pages, tokens}
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
    const base = {issuer: () => ISSUER, store: new InMemoryOAuthStore(), secret: () => "s", interactionPage: async () => {}, scopes: ["x"] as [string]}
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
        const res = await fetch(`${ISSUER}/mcp-down`, {method: "POST", headers: {authorization: `Bearer ${tokens.accessToken}`}})
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

    test("first-party sign-in shows only the login page, issues the app's own access token, then re-auths silently", async () => {
        const browser = new Browser()
        const {pages, tokens} = await signIn(browser, "app", FIRST_PARTY_REDIRECT)
        expect(pages).toEqual([expect.objectContaining({prompt: "login", client: expect.objectContaining({clientId: "app", name: "The App", firstParty: true, redirectHosts: ["app.example"]})})])
        const verified = await userToken.verify(tokens.accessToken)
        expect(verified.sub).toBe("alice")
        expect(verified.data).toEqual({permissions: ["read", "write"]})
        expect(tokens.refreshToken).toEqual(expect.any(String))

        const again = await browser.done(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge))
        expect(again.origin + again.pathname).toBe(FIRST_PARTY_REDIRECT)
        expect(again.searchParams.get("code")).toEqual(expect.any(String))
    })

    test("the login session cookie is HttpOnly, SameSite=Lax and has the configured name", async () => {
        const browser = new Browser()
        await signIn(browser, "app", FIRST_PARTY_REDIRECT)
        const session = browser.setCookies.find(c => c.startsWith(`${SESSION_COOKIE}=`) && !c.startsWith(`${SESSION_COOKIE}=;`))!
        expect(session.toLowerCase()).toContain("httponly")
        expect(session.toLowerCase()).toContain("samesite=lax")
        expect(session).toContain("path=/")
        expect(session.toLowerCase()).not.toContain("domain=")
    })

    test("on an https issuer the login session cookie is __Host-session by default", async () => {
        const setCookies: string[] = []
        // As the proxy forwards it: plain http to the server, X-Forwarded-Proto naming the https it came in on.
        const viaProxy: typeof fetch = async (input, init) => {
            const res = await fetch(String(input).replace(TLS_ISSUER, `http://localhost:${tlsPort}`), {...init, headers: {...init?.headers as Record<string, string>, "x-forwarded-proto": "https"}})
            setCookies.push(...res.headers.getSetCookie())
            return res
        }
        const browser = new GGOAuthHeadlessBrowser({server: TLS_ISSUER, fetch: viaProxy})
        const tls = await new TlsTestRuntime().start()
        const tokens = await browser.signIn({clientId: "app", redirectUri: FIRST_PARTY_REDIRECT, resource: `${TLS_ISSUER}/api`, scope: "api"}, () => ({action: "login", form: {sub: "alice"}}))
            .finally(() => tls.teardown())
        expect((await userToken.verify(tokens.accessToken)).sub).toBe("alice")
        const session = setCookies.find(c => c.startsWith("__Host-session=") && !c.startsWith("__Host-session=;"))!
        expect(session.toLowerCase()).toContain("secure")
        expect(session).toContain("path=/")
        expect(session.toLowerCase()).not.toContain("domain=")
    })

    test("a headless sign-in the user refuses ends with the client's error", async () => {
        const browser = new Browser()
        const consent = {clientId: await register(), redirectUri: THIRD_PARTY_REDIRECT, ...target("mcp")}
        const refused = browser.signIn(consent, (page) => JSON.parse(page.html).interaction.prompt === "login" ? {action: "login", form: {sub: "alice"}} : {action: "deny"})
        await expect(refused).rejects.toMatchObject({error: "access_denied"})
    })

    test("a first-party client without refresh tokens gets only an access token", async () => {
        const {tokens} = await signIn(new Browser(), "identity", IDENTITY_REDIRECT)
        expect((await userToken.verify(tokens.accessToken)).sub).toBe("alice")
        expect(tokens.refreshToken).toBeUndefined()
    })

    test("prompt=login asks for a fresh sign-in even with a live session", async () => {
        const browser = new Browser()
        await signIn(browser, "app", FIRST_PARTY_REDIRECT)
        const forced = await signIn(browser, "app", FIRST_PARTY_REDIRECT, "alice", {prompt: "login"})
        expect(forced.pages).toEqual([expect.objectContaining({prompt: "login", accountId: "alice"})])
    })

    test("a forced login by another account ends the previous login session, then completes as the new account", async () => {
        userPermissions.set("bob", ["read"])
        const browser = new Browser()
        await signIn(browser, "app", FIRST_PARTY_REDIRECT)
        const {tokens} = await signIn(browser, "app", FIRST_PARTY_REDIRECT, "bob", {prompt: "login"})
        expect((await userToken.verify(tokens.accessToken)).sub).toBe("bob")
    })

    test("third-party client registers, needs consent once, and gets a token only for its resource", async () => {
        const clientId = await register()
        const browser = new Browser()
        const {pages, tokens} = await signIn(browser, clientId, THIRD_PARTY_REDIRECT)
        expect(pages.map(p => p.prompt)).toEqual(["login", "consent"])
        expect(pages[1]).toMatchObject({accountId: "alice", resource: MCP, scopes: ["mcp"], client: {name: "Claude", firstParty: false, redirectHosts: ["claude.ai"], loopbackOnly: false}})
        expect((await mcpToken.verify(tokens.accessToken)).data.permissions).toEqual([])
        await expect(userToken.verify(tokens.accessToken)).rejects.toThrow()

        const again = await browser.done(authorizeUrl(clientId, THIRD_PARTY_REDIRECT, pkce().challenge))
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
        const header = JSON.parse(Buffer.from(tokens.accessToken.split(".")[0], "base64url").toString())
        expect(header).toMatchObject({alg: "ES256", kid: "sealed-1", typ: "at+jwt"})

        const remote = new GGAuthAccessToken({signer: new JwksVerifier({jwks: () => `${ISSUER}${ACCESS_TOKEN_JWKS_PATH}`}), claimSchema: IsClaims, audience: "app-mcp", issuer: () => ISSUER})
        const verified = await remote.verify(tokens.accessToken)
        expect(verified.sub).toBe("alice")
        expect(verified.data).toEqual({permissions: []})

        const jwks = await (await fetch(`${ISSUER}${ACCESS_TOKEN_JWKS_PATH}`)).json() as {keys: Array<Record<string, unknown>>}
        expect(jwks.keys.map(k => k.kid)).toEqual(["sealed-1", "sealed-org"])
        expect(jwks.keys.every(k => !("d" in k))).toBe(true)
    })

    test("an access token signed with the ID-token key (derived from the server secret) is refused by the access-token JWKS", async () => {
        const {kid, ...jwk} = deriveEs256Jwk("oauth-test-secret")
        const published = await (await fetch(`${ISSUER}/oauth/jwks`)).json() as {keys: Array<Record<string, unknown>>}
        expect(published.keys.map(k => k.kid)).toContain(kid)
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
        expect((await fetch(MCP, {method: "POST", headers: {authorization: `Bearer ${app.tokens.accessToken}`}})).status).toBe(401)
        const {tokens} = await signIn(new Browser(), await register(), THIRD_PARTY_REDIRECT)
        expect(await (await fetch(MCP, {method: "POST", headers: {authorization: `Bearer ${tokens.accessToken}`}})).json()).toEqual({hello: "alice"})
    })

    test("every resource publishes its metadata, so clients can find the authorization server from it", async () => {
        const api = await (await fetch(`${ISSUER}/.well-known/oauth-protected-resource/api`)).json()
        expect(api).toEqual({resource: API, authorization_servers: [ISSUER], scopes_supported: ["api"], bearer_methods_supported: ["header"]})
        expect((await fetch(`${ISSUER}/.well-known/oauth-protected-resource`)).status).toBe(404)
        expect((await fetch(`${ISSUER}/.well-known/oauth-protected-resource/other`)).status).toBe(404)
    })

    test("a loopback (CLI) client matches on any port and is asked for consent every time", async () => {
        const clientId = await register(["http://127.0.0.1/callback", "http://localhost/callback"])
        expect((await new Browser().page(authorizeUrl(clientId, "http://localhost:51234/callback", pkce().challenge))).interaction.prompt).toBe("login")
        const browser = new Browser()
        const {pages} = await signIn(browser, clientId, "http://127.0.0.1:40123/callback")
        expect(pages[1].client.loopbackOnly).toBe(true)
        // Any local process can claim a loopback redirect, so an existing grant isn't reused silently.
        const again = await browser.page(authorizeUrl(clientId, "http://127.0.0.1:40999/callback", pkce().challenge))
        expect(again.interaction.prompt).toBe("consent")
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
        const browser = new Browser()
        const login = await browser.page(authorizeUrl(await register(), THIRD_PARTY_REDIRECT, pkce().challenge))
        const consent = await browser.page(browser.submit(login, "login", {sub: "alice"}))
        const callback = await browser.done(browser.submit(consent, "deny"))
        expect(callback.searchParams.get("error")).toBe("access_denied")
    })

    test("the sign-in pages answer only the browser that started the flow", async () => {
        const starter = new Browser()
        const login = await starter.page(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge))
        const other = new Browser()
        const page = await other.get(`/oauth/interaction/${login.uid}`)
        expect(page.status).toBe(400)
        expect(await page.text()).toContain("<p>")
        expect((await other.post(`/oauth/interaction/${login.uid}/login`, {sub: "mallory"})).status).toBe(400)
    })

    test("a sign-in POST needs the issuer's Origin and a form body", async () => {
        const browser = new Browser()
        const login = await browser.page(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge))
        const url = `/oauth/interaction/${login.uid}/login`
        expect((await browser.post(url, {sub: "alice"}, "https://evil.example")).status).toBe(403)
        expect((await browser.post(url, {sub: "alice"}, null)).status).toBe(403)
        const json = await browser.get(url, {method: "POST", headers: {origin: ISSUER, "content-type": "application/json"}, body: JSON.stringify({sub: "alice"})})
        expect(json.status).toBe(403)
        expect(await browser.done(browser.submit(login, "login", {sub: "alice"}))).toBeInstanceOf(URL)
    })

    test("a sign-in POST the browser flags same-origin passes from another origin of the issuer, a same-site one doesn't", async () => {
        const browser = new Browser()
        const login = await browser.page(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge))
        const post = (site: string, origin: string) => browser.get(`/oauth/interaction/${login.uid}/login`, {method: "POST", headers: {origin, "sec-fetch-site": site}, body: new URLSearchParams({sub: "alice"})})
        expect((await post("same-site", ISSUER)).status).toBe(403)
        expect((await post("same-origin", "http://localhost:9")).status).toBe(303)
    })

    test("the sign-in pages can't be framed or cached", async () => {
        const browser = new Browser()
        const login = await browser.page(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge))
        const res = await browser.get(`/oauth/interaction/${login.uid}`)
        expect(res.headers.get("x-frame-options")).toBe("DENY")
        expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'")
        expect(res.headers.get("cache-control")).toBe("no-store")
    })

    test("html and redirect answer with the headers a sign-in page needs", async () => {
        const browser = new Browser()
        const login = await browser.page(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge))
        const page = await browser.get(`/oauth/interaction/${login.uid}/html`)
        const away = await browser.post(`/oauth/interaction/${login.uid}/redirect`, {})
        expect([page.status, await page.text(), away.status, away.headers.get("location")]).toEqual([200, "<p>page</p>", 303, "https://elsewhere.example/"])
        for (const res of [page, away]) {
            expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8")
            expect(res.headers.get("referrer-policy")).toBe("same-origin")
            expect(res.headers.get("cache-control")).toBe("no-store")
        }
    })

    test("consent is refused while the user still has to sign in", async () => {
        const browser = new Browser()
        const login = await browser.page(authorizeUrl(await register(), THIRD_PARTY_REDIRECT, pkce().challenge))
        expect((await browser.post(`/oauth/interaction/${login.uid}/consent`, {})).status).toBe(400)
    })

    test("extraParams reach the sign-in page; other parameters don't", async () => {
        const page = await new Browser().page(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge, {start_with: "github"}))
        expect(page.interaction.params).toEqual({start_with: "github"})
    })

    test("a login ticket completes only in the browser that started the flow", async () => {
        const starter = new Browser()
        const flow = await starter.authorize(APP)
        const login = await starter.page(Promise.resolve(flow.step))
        const url = await oauth.loginTicketUrl(login.uid, "alice")
        bearers.add(new URL(url).searchParams.get("ticket")!)
        expect(new URL(url).pathname).toBe(`/oauth/interaction/${login.uid}/complete`)
        expect((await new Browser().get(url)).status).toBe(400)
        // Single use: the other browser's attempt spent it.
        expect((await starter.get(url)).status).toBe(400)

        const tokens = await flow.finish(await starter.done(await oauth.loginTicketUrl(login.uid, "alice")))
        expect((await userToken.verify(tokens.accessToken)).sub).toBe("alice")
    })

    test("of two concurrent redemptions of one login ticket, only one wins", async () => {
        const starter = new Browser()
        const login = await starter.page(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge))
        const url = await oauth.loginTicketUrl(login.uid, "alice")
        bearers.add(new URL(url).searchParams.get("ticket")!)
        // Slow reads: both requests have read the ticket before either writes.
        dynamo.slowReads = true
        const results = await Promise.all([starter.get(url), starter.get(url)]).finally(() => { dynamo.slowReads = false })
        expect(results.map(r => r.status).sort()).toEqual([303, 400])
    })

    describe("external sign-in", () => {
        const startExternal = async (browser: Browser) => {
            const {step, finish} = await browser.authorize(APP)
            const login = await browser.page(Promise.resolve(step))
            const start = await browser.get(`/ext/start?uid=${login.uid}`)
            const upstream = new URL(start.headers.get("location")!)
            expect(upstream.origin).toBe(UPSTREAM)
            return {uid: login.uid, finish, state: upstream.searchParams.get("state")!, setCookie: start.headers.get("set-cookie")!}
        }

        test("a state cookie for the round trip, then a login ticket for the account the app resolved", async () => {
            const browser = new Browser()
            const {uid, finish, state, setCookie} = await startExternal(browser)
            expect(setCookie).toMatch(new RegExp(`^gg_signin_${state}=[^;]+; Path=/ext/callback; Max-Age=600; HttpOnly; Secure; SameSite=Lax$`))

            const back = await browser.get(`/ext/callback?code=alice&state=${state}`)
            expect(back.status).toBe(302)
            expect(back.headers.get("set-cookie")).toMatch(new RegExp(`^gg_signin_${state}=; Path=/ext/callback; Max-Age=0;`))
            const ticket = new URL(back.headers.get("location")!)
            expect(ticket.pathname).toBe(`/oauth/interaction/${uid}/complete`)
            bearers.add(ticket.searchParams.get("ticket")!)

            const tokens = await finish(await browser.done(ticket.href))
            expect((await userToken.verify(tokens.accessToken)).sub).toBe("alice")
        })

        test("the upstream's error goes back to the flow's page as the app's code; a forged one is not this flow's", async () => {
            const browser = new Browser()
            const {uid, state} = await startExternal(browser)
            for (const forged of [new Browser().get(`/ext/callback?error=access_denied&state=${state}`), browser.get("/ext/callback?error=access_denied&state=guessed")]) {
                expect(await (await forged).text()).toBe("not a sign-in")
            }
            const back = await browser.get(`/ext/callback?error=access_denied&state=${state}`)
            expect(back.headers.get("location")).toBe(await oauth.interactionUrl(uid, "cancelled"))
        })

        test("a tampered or expired state cookie goes to the fallback, and is cleared", async () => {
            const browser = new Browser()
            const {state} = await startExternal(browser)
            const name = `gg_signin_${state}`
            const raw = browser.cookies.get(name)!
            browser.cookies.set(name, raw.slice(0, -2) + (raw.endsWith("AA") ? "BB" : "AA"))
            const tampered = await browser.get(`/ext/callback?code=mallory&state=${state}`)
            expect(tampered.headers.get("location")).toBe(`${ISSUER}/fallback`)
            expect(tampered.headers.get("set-cookie")).toContain("Max-Age=0")

            const expired = new Browser()
            const fresh = await startExternal(expired)
            vi.useFakeTimers({toFake: ["Date"], now: Date.now() + 601_000})
            try {
                expect((await expired.get(`/ext/callback?code=alice&state=${fresh.state}`)).headers.get("location")).toBe(`${ISSUER}/fallback`)
            } finally {
                vi.useRealTimers()
            }
        })

        test("a sign-in that expired meanwhile goes to the fallback", async () => {
            const browser = new Browser()
            const {uid, state} = await startExternal(browser)
            await store.destroy("Interaction", uid)
            expect((await browser.get(`/ext/callback?code=alice&state=${state}`)).headers.get("location")).toBe(`${ISSUER}/fallback`)
        })

        test("start refuses data too large for a cookie", async () => {
            await expect(external.start("uid", async () => ({url: UPSTREAM, data: {nonce: "x".repeat(5000)}}))).rejects.toThrow(/too large/)
        })
    })

    test("refresh rotates, re-resolves claims, and treats replay as reuse", async () => {
        const {tokens} = await signIn(new Browser(), "app", FIRST_PARTY_REDIRECT)
        userPermissions.set("alice", ["read"])
        const refreshed = await token({grant_type: "refresh_token", refresh_token: tokens.refreshToken!, client_id: "app"})
        expect((await userToken.verify(refreshed.access_token)).data.permissions).toEqual(["read"])
        expect(refreshed.refresh_token).not.toBe(tokens.refreshToken)

        expect((await token({grant_type: "refresh_token", refresh_token: tokens.refreshToken!, client_id: "app"})).error).toBe("invalid_grant")
        expect((await token({grant_type: "refresh_token", refresh_token: refreshed.refresh_token, client_id: "app"})).error).toBe("invalid_grant")
    })

    test("an access token carries the sign-in time, and a refresh keeps it", async () => {
        const before = Math.floor(Date.now() / 1000)
        const {tokens} = await signIn(new Browser(), "app", FIRST_PARTY_REDIRECT)
        const signedIn = (await userToken.verify(tokens.accessToken)).auth_time!
        expect(signedIn).toBeGreaterThanOrEqual(before)
        vi.useFakeTimers({toFake: ["Date"], now: Date.now() + 60_000})
        try {
            const refreshed = await userToken.verify((await token({grant_type: "refresh_token", refresh_token: tokens.refreshToken!, client_id: "app"})).access_token)
            expect(refreshed.iat).toBeGreaterThanOrEqual(signedIn + 60)
            expect(refreshed.auth_time).toBe(signedIn)
        } finally {
            vi.useRealTimers()
        }
    })

    test("a silent re-auth carries the login session's sign-in time", async () => {
        const browser = new Browser()
        const {tokens} = await signIn(browser, "app", FIRST_PARTY_REDIRECT)
        const signedIn = (await userToken.verify(tokens.accessToken)).auth_time!
        vi.useFakeTimers({toFake: ["Date"], now: Date.now() + 120_000})
        try {
            const again = await browser.signIn(APP, () => { throw new Error("no sign-in page expected") })
            expect((await userToken.verify(again.accessToken)).auth_time).toBe(signedIn)
        } finally {
            vi.useRealTimers()
        }
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
        expect((await token({grant_type: "refresh_token", refresh_token: tokens.refreshToken!, client_id: clientId})).access_token).toEqual(expect.any(String))
        expect(await lastUsed()).toBeGreaterThan(first)
    })

    test("refresh fails once the subject is gone", async () => {
        const {tokens} = await signIn(new Browser(), "app", FIRST_PARTY_REDIRECT)
        userPermissions.set("alice", undefined)
        expect((await token({grant_type: "refresh_token", refresh_token: tokens.refreshToken!, client_id: "app"})).error).toBe("invalid_grant")
    })

    test("revoking a grant kills its refresh token; revokeAll ends the login session", async () => {
        const clientId = await register()
        const browser = new Browser()
        const {tokens} = await signIn(browser, clientId, THIRD_PARTY_REDIRECT)
        const grant = (await oauth.listGrants("alice")).find(g => g.clientId === clientId)!
        expect(await store.find("GrantUsage", grant.grantId)).toBeDefined()
        await oauth.revokeGrant("alice", grant.grantId)
        expect(await store.find("GrantUsage", grant.grantId)).toBeUndefined()
        expect((await token({grant_type: "refresh_token", refresh_token: tokens.refreshToken!, client_id: clientId})).error).toBe("invalid_grant")
        expect((await oauth.listGrants("alice")).map(g => g.grantId)).not.toContain(grant.grantId)

        const appBrowser = new Browser()
        const app = await signIn(appBrowser, "app", FIRST_PARTY_REDIRECT)
        await oauth.revokeAll("alice")
        expect(await oauth.listGrants("alice")).toEqual([])
        expect((await token({grant_type: "refresh_token", refresh_token: app.tokens.refreshToken!, client_id: "app"})).error).toBe("invalid_grant")
        const after = (await appBrowser.page(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge))).interaction
        expect([after.prompt, after.accountId]).toEqual(["login", undefined])
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

        const after = (await browser.page(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge))).interaction
        expect([after.prompt, after.accountId]).toEqual(["login", undefined])
        expect((await token({grant_type: "refresh_token", refresh_token: connected.tokens.refreshToken!, client_id: mcpClient})).access_token).toEqual(expect.any(String))
    })

    test("a login ticket link never points at a host the request named itself", async () => {
        // A client can't set Host from fetch; X-Forwarded-Host (trusted behind a proxy) feeds the same value.
        const res = await fetch(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge), {redirect: "manual", headers: {"x-forwarded-host": "evil.example"}})
        const uid = new URL(res.headers.get("location")!, "https://evil.example").pathname.split("/").pop()!
        expect(new URL(await oauth.loginTicketUrl(uid, "alice")).origin).toBe(ISSUER)
        expect(await oauth.interactionUrl(uid)).toBe(`${ISSUER}/oauth/interaction/${uid}`)
        expect(await oauth.interactionUrl(uid, "not linked&x")).toBe(`${ISSUER}/oauth/interaction/${uid}?error=not%20linked%26x`)

        const meta = await (await fetch(`${ISSUER}/.well-known/oauth-authorization-server`, {headers: {"x-forwarded-host": "evil.example"}})).json()
        expect(new URL(meta.token_endpoint).origin).toBe(ISSUER)
    })

    test("a refresh that fails before issuing (claims unavailable) can be retried", async () => {
        const {tokens} = await signIn(new Browser(), "app", FIRST_PARTY_REDIRECT)
        failClaimsOnce = true
        const failed = await fetch(`${ISSUER}/oauth/token`, {method: "POST", body: new URLSearchParams({grant_type: "refresh_token", refresh_token: tokens.refreshToken!, client_id: "app"})})
        expect(failed.status).toBe(500)
        expect((await token({grant_type: "refresh_token", refresh_token: tokens.refreshToken!, client_id: "app"})).access_token).toEqual(expect.any(String))
    })

    test("a refresh asking for a resource the token can't have fails without using the token up", async () => {
        const clientId = await register()
        const {tokens} = await signIn(new Browser(), clientId, THIRD_PARTY_REDIRECT)
        const wrong = await token({grant_type: "refresh_token", refresh_token: tokens.refreshToken!, client_id: clientId, resource: API})
        expect(wrong.error).toBe("invalid_target")
        expect((await token({grant_type: "refresh_token", refresh_token: tokens.refreshToken!, client_id: clientId})).access_token).toEqual(expect.any(String))
    })

    test("of two concurrent refreshes with one token, only one succeeds", async () => {
        const {tokens} = await signIn(new Browser(), "app", FIRST_PARTY_REDIRECT)
        const body = {grant_type: "refresh_token", refresh_token: tokens.refreshToken!, client_id: "app"}
        const results = await Promise.all([token(body), token(body)])
        // Never two live lineages from one token; the loser gets invalid_grant (not a retryable 5xx).
        expect(results.map(r => r.error ?? "ok").sort()).toEqual(["invalid_grant", "ok"])
    })

    const backend = (secret = "backend-secret") => new GGOAuthServiceClient({url: () => ISSUER, clientId: "backend", secret: () => secret})

    test("a service client gets a token for its service-only resource", async () => {
        const verified = await internalToken.verify(await backend().token(INTERNAL))
        expect(verified.sub).toBe("backend")
        expect(verified.data).toEqual({permissions: ["internal"]})
    })

    test("a service token is refused for a wrong secret and any resource that isn't service-only", async () => {
        expect(await backend("nope").token(INTERNAL).catch((e: unknown) => e)).toBeInstanceOf(NOT_AUTHORIZED)
        expect(await new GGOAuthServiceClient({url: () => ISSUER, clientId: "app", secret: () => ""}).token(INTERNAL).catch((e: unknown) => e)).toBeInstanceOf(NOT_AUTHORIZED)
        expect(await backend().token(API).catch((e: unknown) => e)).toBeInstanceOf(FORBIDDEN)
    })

    test("malformed service client credentials are NOT_AUTHORIZED, not a server error", async () => {
        const call = (authorization: string) => fetch(`${ISSUER}/oauth-service/token`, {
            method: "POST", headers: {authorization, "content-type": "application/json"}, body: JSON.stringify({resource: INTERNAL}),
        }).then(r => r.json())
        for (const authorization of [`Basic ${Buffer.from("backend:%E0%A4%A").toString("base64")}`, "Basic !!!", "Bearer x", ""]) {
            expect((await call(authorization)).type).toBe("NOT_AUTHORIZED")
        }
    })

    test("a registered client can't use client_credentials", async () => {
        const res = await fetch(`${ISSUER}/oauth/register`, {
            method: "POST", headers: {"content-type": "application/json"},
            body: JSON.stringify({client_name: "Sneaky", redirect_uris: [THIRD_PARTY_REDIRECT], application_type: "web", token_endpoint_auth_method: "client_secret_basic", grant_types: ["authorization_code", "client_credentials"]}),
        })
        const {client_id, client_secret} = await res.json()
        // An app whose claims would happily answer for this subject: only the grant check stops it.
        userPermissions.set(client_id, ["read"])
        for (const resource of [undefined, MCP, INTERNAL]) {
            const body = await fetch(`${ISSUER}/oauth/token`, {method: "POST", headers: {authorization: basic(client_id ?? "x", client_secret ?? "x")}, body: new URLSearchParams({grant_type: "client_credentials", ...(resource ? {resource} : {})})}).then(r => r.json())
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
        const ok = await backend().exchange(tokens.accessToken, ORG, {org_id: "o1"})
        expect(ok.expiresAt).toBeGreaterThan(Date.now())
        const verified = await orgToken.verify(ok.token)
        expect(verified.sub).toBe("alice")
        expect(verified.auth_time).toBe((await userToken.verify(tokens.accessToken)).auth_time)
        expect(verified.data).toEqual({permissions: ["org:alice"]})

        const refused = (subjectToken: string, resource: string, params: Record<string, string>, client = backend()) => client.exchange(subjectToken, resource, params).catch((e: unknown) => e)
        expect(await refused(tokens.accessToken, ORG, {org_id: "o2"})).toBeInstanceOf(FORBIDDEN)
        expect(await refused("garbage", ORG, {org_id: "o1"})).toBeInstanceOf(SUBJECT_TOKEN_INVALID)
        expect(await refused(tokens.accessToken, MCP, {org_id: "o1"})).toBeInstanceOf(FORBIDDEN)
        expect(await refused(tokens.accessToken, ORG, {org_id: "o1"}, backend("nope"))).toBeInstanceOf(NOT_AUTHORIZED)
    })

    test("GGOAuthServiceClient reuses its token, and concurrent callers share one request", async () => {
        const client = backend()
        const [first, concurrent] = await Promise.all([client.token(INTERNAL), client.token(INTERNAL)])
        expect(concurrent).toBe(first)
        expect(await client.token(INTERNAL)).toBe(first)
    })

    test("the token endpoint offers no token exchange", async () => {
        const {tokens} = await signIn(new Browser(), "app", FIRST_PARTY_REDIRECT)
        const body = await token({grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", client_id: "app", subject_token: tokens.accessToken, subject_token_type: "urn:ietf:params:oauth:token-type:access_token", resource: ORG, org_id: "o1"})
        expect(body.access_token).toBeUndefined()
        expect(body.error).toEqual(expect.any(String))
    })

    test("no stored row holds a bearer value, in its key or payload", async () => {
        const browser = new Browser()
        const {tokens} = await signIn(browser, "app", FIRST_PARTY_REDIRECT)
        await token({grant_type: "refresh_token", refresh_token: tokens.refreshToken!, client_id: "app"})
        // Left pending: its Interaction copies the login session, and its ticket is never redeemed.
        const pending = await browser.page(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge, {prompt: "login"}))
        bearers.add(new URL(await oauth.loginTicketUrl(pending.uid, "alice")).searchParams.get("ticket")!)
        const stored = [...dynamo.rows.values()].map(row => JSON.stringify(row))
        for (const bearer of bearers) expect(stored.filter(row => row.includes(bearer))).toEqual([])
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
