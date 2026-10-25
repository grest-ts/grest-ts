import {createHash, randomBytes} from "node:crypto"
import {createServer} from "node:net"
import {GGRuntime} from "@grest-ts/runtime"
import {GGHeader, GGHttp, GGHttpSchema, GGHttpServer, GGRpc} from "@grest-ts/http"
import {GGContextKey} from "@grest-ts/context"
import {IsArray, IsObject, IsString, NOT_AUTHORIZED} from "@grest-ts/schema"
import {GGAuthAccessToken, HmacSigner} from "@grest-ts/auth"
import {GGOAuthServer, type GGOAuthResource} from "./GGOAuthServer"
import {InMemoryOAuthStore} from "./store/InMemoryOAuthStore"
import {GGOAuthInteractionContract} from "../shared/interactionContract"

const IsClaims = IsObject({permissions: IsArray(IsString)})
type Claims = typeof IsClaims.infer

const port = await freePort()
const ISSUER = `http://localhost:${port}`
const API = `${ISSUER}/api`
const APP_LOGIN = "https://app.example/oauth-login"
const FIRST_PARTY_REDIRECT = "https://app.example/callback"
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

// A second resource, as for an MCP server: its own audience, and tokens that grant no permissions.
const MCP = `${ISSUER}/mcp`
const mcpToken = new GGAuthAccessToken({signer: new HmacSigner("app-token-secret"), claimSchema: IsClaims, audience: "app-mcp"})
const mcp: GGOAuthResource<Claims> = {
    resource: () => MCP,
    accessToken: mcpToken,
    scopes: ["mcp"],
    claims: async (sub) => userPermissions.get(sub) ? {permissions: []} : undefined,
}
// What a client asks for: the first-party app its API, anyone else the MCP resource.
const target = (clientId: string) => clientId === "app" ? {resource: API, scope: "api"} : {resource: MCP, scope: "mcp"}

let oauth!: GGOAuthServer

class OAuthTestRuntime extends GGRuntime {
    public static readonly NAME = "oauth-test"

    protected compose(): void {
        const server = new GGHttpServer({port})
        USER_WIRE_HANDLER.create(undefined)
        oauth = new GGOAuthServer({
            issuer: () => ISSUER,
            store: new InMemoryOAuthStore(),
            secret: () => "oauth-test-secret",
            resources: [{
                resource: () => API,
                accessToken: userToken,
                scopes: ["api"],
                firstPartyOnly: true,
                claims: async (sub) => {
                    if (failClaimsOnce) {
                        failClaimsOnce = false
                        throw new Error("store unavailable")
                    }
                    const permissions = userPermissions.get(sub)
                    return permissions ? {permissions} : undefined
                },
            }, mcp],
            interactionUrl: (uid) => `${APP_LOGIN}?uid=${uid}`,
            firstPartyClients: () => [{clientId: "app", name: "The App", redirectUris: [FIRST_PARTY_REDIRECT], postLogoutRedirectUris: ["https://app.example/"]}],
            dynamicRegistration: true,
            clientIdMetadataDocument: {allowedUrlPrefixes: () => ["https://clients.example/oauth/"]},
            proxy: true,
        })
        oauth.mount(server)
        oauth.protect(server, mcp, "/mcp", async (_req, res, token) => {
            res.writeHead(200, {"content-type": "application/json"})
            res.end(JSON.stringify({hello: token.sub}))
        })
        new GGHttp(server).http(InteractionApi, oauth.interactionApi(() => SUBJECT.get()!.sub))
    }
}

// A browser: keeps cookies, never follows redirects on its own.
class Browser {
    private readonly jar = new Map<string, string>()

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

async function signIn(browser: Browser, clientId: string, redirectUri: string, sub = "alice") {
    const {verifier, challenge} = pkce()
    const login = await browser.navigate(authorizeUrl(clientId, redirectUri, challenge))
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
        expect(meta.scopes_supported).toEqual(["openid", "offline_access", "api", "mcp"])
        const jwks = await (await fetch(meta.jwks_uri)).json()
        expect(jwks.keys).toEqual([expect.objectContaining({kty: "EC", crv: "P-256", alg: "ES256"})])
        expect(jwks.keys[0].d).toBeUndefined()
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

    test("third-party client registers, needs consent once, and gets a token only for its resource", async () => {
        const clientId = await register()
        const browser = new Browser()
        const {details, tokens} = await signIn(browser, clientId, THIRD_PARTY_REDIRECT)
        expect(details).toMatchObject({resource: MCP, client: {name: "Claude", firstParty: false, redirectHosts: ["claude.ai"], loopbackOnly: false}})
        expect((await mcpToken.verify(tokens.access_token)).data.permissions).toEqual([])
        await expect(userToken.verify(tokens.access_token)).rejects.toThrow()

        const again = await browser.navigate(authorizeUrl(clientId, THIRD_PARTY_REDIRECT, pkce().challenge))
        expect(again.searchParams.get("code")).toEqual(expect.any(String))

        expect(await oauth.listGrants("alice")).toEqual(expect.arrayContaining([expect.objectContaining({clientId, clientName: "Claude"})]))
    })

    test("a third-party client can't get a token for a first-party-only resource", async () => {
        const clientId = await register()
        const res = await new Browser().get(authorizeUrl(clientId, THIRD_PARTY_REDIRECT, pkce().challenge, {resource: API, scope: "api"}))
        expect(res.status).toBe(303)
        expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_target")
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
        expect(await lastUsed()).toBeGreaterThanOrEqual(before)
        expect(await lastUsed()).toBeLessThanOrEqual(signedIn)

        expect((await token({grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId})).access_token).toEqual(expect.any(String))
        expect(await lastUsed()).toBeGreaterThanOrEqual(signedIn)
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
        await oauth.revokeGrant("alice", grant.grantId)
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
