import {createHash, randomBytes} from "node:crypto"
import {createServer} from "node:net"
import {exportJWK, generateKeyPair} from "jose"
import {GGRuntime} from "@grest-ts/runtime"
import {GGHeader, GGHttp, GGHttpSchema, GGHttpServer, GGRpc} from "@grest-ts/http"
import {GGContextKey} from "@grest-ts/context"
import {IsArray, IsObject, IsString, NOT_AUTHORIZED} from "@grest-ts/schema"
import {GGAuthAccessToken, HmacSigner} from "@grest-ts/auth"
import {GGOAuthServer} from "./GGOAuthServer"
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

const {privateKey} = await generateKeyPair("ES256", {extractable: true})
const signingJwk = JSON.stringify({...await exportJWK(privateKey), alg: "ES256", kid: "test"})

let oauth!: GGOAuthServer<Claims>

class OAuthTestRuntime extends GGRuntime {
    public static readonly NAME = "oauth-test"

    protected compose(): void {
        const server = new GGHttpServer({port})
        USER_WIRE_HANDLER.create(undefined)
        oauth = new GGOAuthServer<Claims>({
            issuer: () => ISSUER,
            store: new InMemoryOAuthStore(),
            signingJwk: () => signingJwk,
            cookieKeys: () => ["cookie-key"],
            accessToken: userToken,
            resource: () => API,
            scopes: ["api"],
            claims: async (sub) => {
                const permissions = userPermissions.get(sub)
                return permissions ? {permissions} : undefined
            },
            interactionUrl: (uid) => `${APP_LOGIN}?uid=${uid}`,
            firstPartyClients: [{clientId: "app", name: "The App", redirectUris: [FIRST_PARTY_REDIRECT]}],
            dynamicRegistration: true,
            clientIdMetadataDocument: true,
        })
        oauth.mount(server)
        new GGHttp(server).http(InteractionApi, oauth.interactionApi(() => SUBJECT.get()!.sub))
    }
}

// A browser: keeps cookies, never follows redirects on its own.
class Browser {
    private readonly jar = new Map<string, string>()

    async get(url: string): Promise<Response> {
        const res = await fetch(new URL(url, ISSUER), {redirect: "manual", headers: this.jar.size ? {cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ")} : {}})
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
    url.search = new URLSearchParams({client_id: clientId, response_type: "code", redirect_uri: redirectUri, state: "st", code_challenge: challenge, code_challenge_method: "S256", resource: API, scope: "api", ...extra}).toString()
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
    const tokens = await token({grant_type: "authorization_code", code: callback.searchParams.get("code")!, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource: API})
    return {details: details.data, tokens}
}

async function register(): Promise<string> {
    const res = await fetch(`${ISSUER}/oauth/register`, {
        method: "POST", headers: {"content-type": "application/json"},
        body: JSON.stringify({client_name: "Claude", redirect_uris: [THIRD_PARTY_REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"]}),
    })
    expect(res.status).toBe(201)
    return (await res.json()).client_id
}

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

    test("third-party client registers, needs consent once, and gets the same token kind", async () => {
        const clientId = await register()
        const browser = new Browser()
        const {details, tokens} = await signIn(browser, clientId, THIRD_PARTY_REDIRECT)
        expect(details.client).toMatchObject({name: "Claude", firstParty: false, redirectHosts: ["claude.ai"], loopbackOnly: false})
        expect((await userToken.verify(tokens.access_token)).data.permissions).toEqual(["read", "write"])

        const again = await browser.navigate(authorizeUrl(clientId, THIRD_PARTY_REDIRECT, pkce().challenge))
        expect(again.searchParams.get("code")).toEqual(expect.any(String))

        expect(await oauth.listGrants("alice")).toEqual(expect.arrayContaining([expect.objectContaining({clientId, clientName: "Claude"})]))
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

        const appBrowser = new Browser()
        const app = await signIn(appBrowser, "app", FIRST_PARTY_REDIRECT)
        await oauth.revokeAll("alice")
        expect((await token({grant_type: "refresh_token", refresh_token: app.tokens.refresh_token, client_id: "app"})).error).toBe("invalid_grant")
        const after = await appBrowser.navigate(authorizeUrl("app", FIRST_PARTY_REDIRECT, pkce().challenge))
        expect(after.origin + after.pathname).toBe(APP_LOGIN)
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
