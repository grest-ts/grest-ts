import {createHash} from "node:crypto"
import {describe, test, expect, beforeAll, beforeEach} from "vitest"
import {SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWTPayload} from "jose"
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {OidcRelyingParty} from "./OidcRelyingParty"

const ISSUER = "https://idp.test"
const CLIENT_ID = "app-client"
const REDIRECT = "https://api.app.test/auth/oidc/callback"

// The IdP's endpoints, as the relying party reaches them through its `fetch`.
class FakeIdp {
    signingKey!: CryptoKey
    kid = "k1"
    jwks!: {keys: object[]}
    lastTokenRequest: URLSearchParams | undefined
    lastTokenAuthorization: string | undefined
    idToken: {claims?: JWTPayload, key?: CryptoKey} = {}
    lastNonce: string | undefined
    token: {refreshToken?: string, omitIdToken?: boolean, error?: {status: number, body: object}} = {}
    userinfo: object | "broken" | undefined

    async init(): Promise<void> {
        const {privateKey, publicKey} = await generateKeyPair("RS256")
        this.signingKey = privateKey
        this.jwks = {keys: [{...await exportJWK(publicKey), kid: this.kid, alg: "RS256", use: "sig"}]}
    }

    fetch = async (url: string, options: {body?: unknown, headers?: ConstructorParameters<typeof Headers>[0]}): Promise<Response> => {
        const {pathname} = new URL(url)
        if (pathname === "/.well-known/openid-configuration") return Response.json({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/authorize`,
            token_endpoint: `${ISSUER}/token`,
            jwks_uri: `${ISSUER}/keys`,
            id_token_signing_alg_values_supported: ["RS256"],
            ...this.userinfo ? {userinfo_endpoint: `${ISSUER}/userinfo`} : {},
        })
        if (pathname === "/userinfo" && this.userinfo) return this.userinfo === "broken" ? new Response("oops", {status: 502}) : Response.json(this.userinfo)
        if (pathname === "/keys") return Response.json(this.jwks)
        if (pathname === "/token") {
            this.lastTokenRequest = new URLSearchParams(String(options.body))
            this.lastTokenAuthorization = new Headers(options.headers).get("authorization") ?? undefined
            if (this.token.error) return Response.json(this.token.error.body, {status: this.token.error.status})
            const refresh = this.token.refreshToken ? {refresh_token: this.token.refreshToken} : {}
            if (this.token.omitIdToken) return Response.json({access_token: "at", token_type: "Bearer", expires_in: 300, ...refresh})
            const now = Math.floor(Date.now() / 1000)
            const idToken = await new SignJWT({
                iss: ISSUER, aud: CLIENT_ID, sub: "00u-alice", iat: now, exp: now + 300,
                nonce: this.lastNonce, email: "alice@corp.test", email_verified: true,
                given_name: "Alice", groups: ["users"],
                ...this.idToken.claims,
            }).setProtectedHeader({alg: "RS256", kid: this.kid}).sign(this.idToken.key ?? this.signingKey)
            return Response.json({access_token: "at", token_type: "Bearer", expires_in: 300, id_token: idToken, ...refresh})
        }
        return new Response("not found", {status: 404})
    }
}

describe("OidcRelyingParty", () => {
    const fake = new FakeIdp()
    beforeAll(() => fake.init())
    beforeEach(() => {
        fake.token = {}
        fake.idToken = {}
        fake.userinfo = undefined
    })

    const rp = () => new OidcRelyingParty({
        issuer: () => ISSUER,
        clientId: () => CLIENT_ID,
        clientSecret: () => "s3cret",
        redirectUri: () => REDIRECT,
        scope: () => "openid email profile",
        fetch: fake.fetch as never,
    })

    const signIn = async (party = rp()) => {
        const {url, checks} = await party.authorize()
        fake.lastNonce = new URL(url).searchParams.get("nonce")!
        return party.callback(`?code=abc&state=${encodeURIComponent(checks.state)}`, checks)
    }

    test("builds an authorize URL with PKCE S256, state, nonce, scope and the redirect URI", async () => {
        const {url, checks} = await rp().authorize({prompt: "login"})
        const params = new URL(url).searchParams
        expect(url.startsWith(`${ISSUER}/authorize?`)).toBe(true)
        expect(params.get("client_id")).toBe(CLIENT_ID)
        expect(params.get("redirect_uri")).toBe(REDIRECT)
        expect(params.get("scope")).toBe("openid email profile")
        expect(params.get("prompt")).toBe("login")
        expect(params.get("state")).toBe(checks.state)
        expect(params.get("nonce")).toBe(checks.nonce)
        expect(params.get("code_challenge_method")).toBe("S256")
        expect(params.get("code_challenge")).toBe(createHash("sha256").update(checks.pkceVerifier).digest("base64url"))
    })

    test("uses a given state", async () => {
        const {url, checks} = await rp().authorize({state: "given"})
        expect([checks.state, new URL(url).searchParams.get("state")]).toEqual(["given", "given"])
    })

    test("exchanges the code with the PKCE verifier and client_secret_basic, and returns the verified identity", async () => {
        const {identity} = await signIn()
        expect(identity).toMatchObject({
            provider: "oidc", subject: "00u-alice", email: "alice@corp.test", emailVerified: true, name: undefined,
            claims: expect.objectContaining({iss: ISSUER, given_name: "Alice", groups: ["users"]}),
        })
        expect(fake.lastTokenRequest?.get("code_verifier")).toMatch(/.{43,}/)
        expect(fake.lastTokenRequest?.get("redirect_uri")).toBe(REDIRECT)
        const basic = atob(fake.lastTokenAuthorization!.replace(/^Basic /, "")).split(":").map(decodeURIComponent)
        expect(basic).toEqual([CLIENT_ID, "s3cret"])
        expect(fake.lastTokenRequest?.get("client_secret")).toBeNull()
    })

    test("returns the refresh token the IdP issued alongside the identity", async () => {
        fake.token = {refreshToken: "rt-1"}
        expect((await signIn()).refreshToken).toBe("rt-1")
    })

    test("accepts email_verified sent as a string", async () => {
        fake.idToken = {claims: {email_verified: "true"}}
        expect((await signIn()).identity.emailVerified).toBe(true)
    })

    test("rejects an ID token signed by a key outside the IdP's JWKS", async () => {
        fake.idToken = {key: (await generateKeyPair("RS256")).privateKey}
        await expect(signIn()).rejects.toMatchObject({cause: {message: "JWT signature verification failed"}})
    })

    test("rejects an ID token for another audience", async () => {
        fake.idToken = {claims: {aud: "someone-else"}}
        await expect(signIn()).rejects.toMatchObject({message: "unexpected JWT claim value encountered", cause: {cause: {claim: "aud"}}})
    })

    test("rejects an ID token from another issuer", async () => {
        fake.idToken = {claims: {iss: "https://evil.test"}}
        await expect(signIn()).rejects.toMatchObject({message: "unexpected JWT claim value encountered", cause: {cause: {claim: "iss"}}})
    })

    test("rejects an expired ID token", async () => {
        const past = Math.floor(Date.now() / 1000) - 3600
        fake.idToken = {claims: {iat: past - 300, exp: past}}
        await expect(signIn()).rejects.toMatchObject({cause: {cause: {claim: "exp"}}})
    })

    test("rejects a replayed nonce", async () => {
        fake.idToken = {claims: {nonce: "not-the-one-we-sent"}}
        await expect(signIn()).rejects.toMatchObject({message: "unexpected JWT claim value encountered", cause: {cause: {claim: "nonce"}}})
    })

    test("rejects a callback whose state differs from the one sent", async () => {
        const party = rp()
        const {checks} = await party.authorize()
        await expect(party.callback("?code=abc&state=forged", checks)).rejects.toMatchObject({cause: {message: 'unexpected "state" response parameter value'}})
    })

    test("reads its settings at use", async () => {
        let issuer = "https://other.test"
        const party = new OidcRelyingParty({issuer: () => issuer, clientId: () => CLIENT_ID, clientSecret: () => "s", redirectUri: () => REDIRECT, scope: () => "openid", fetch: fake.fetch as never})
        await expect(party.authorize()).rejects.toThrow()
        issuer = ISSUER
        expect((await party.authorize()).url.startsWith(`${ISSUER}/authorize?`)).toBe(true)
    })

    describe("refresh", () => {
        const refresh = () => rp().refresh("rt-old", "00u-alice")

        test("spends the refresh token and returns the refreshed claims and rotated token", async () => {
            fake.idToken = {claims: {nonce: undefined, groups: ["admins"]}}
            fake.token = {refreshToken: "rt-new"}
            expect(await refresh()).toMatchObject({ended: false, refreshToken: "rt-new", accessToken: "at", claims: expect.objectContaining({groups: ["admins"]})})
            expect(fake.lastTokenRequest?.get("grant_type")).toBe("refresh_token")
            expect(fake.lastTokenRequest?.get("refresh_token")).toBe("rt-old")
        })

        test("keeps the refresh token when the IdP doesn't rotate it", async () => {
            fake.idToken = {claims: {nonce: undefined}}
            expect(await refresh()).toMatchObject({ended: false, refreshToken: "rt-old"})
        })

        test("has no claims when the IdP sends no ID token", async () => {
            fake.token = {omitIdToken: true}
            expect(await refresh()).toEqual({ended: false, refreshToken: "rt-old", accessToken: "at", claims: undefined})
        })

        test("ends the session when the IdP refuses the grant", async () => {
            fake.token = {error: {status: 400, body: {error: "invalid_grant", error_description: "The refresh token is invalid or expired."}}}
            expect(await refresh()).toEqual({ended: true, reason: "The refresh token is invalid or expired."})
        })

        test("ends the session when the refreshed ID token is for someone else", async () => {
            fake.idToken = {claims: {nonce: undefined, sub: "00u-mallory"}}
            expect(await refresh()).toEqual({ended: true, reason: "refreshed ID token is for another subject"})
        })

        test("treats any other failure as the IdP being unreachable, not as an ended session", async () => {
            fake.token = {error: {status: 503, body: {error: "temporarily_unavailable"}}}
            await expect(refresh()).rejects.toThrow()
        })
    })

    describe("userinfo", () => {
        test("reads the claims, or nothing when the IdP has no userinfo endpoint", async () => {
            fake.userinfo = {sub: "00u-alice", groups: ["users"]}
            expect(await rp().userinfo("at", "00u-alice")).toEqual({sub: "00u-alice", groups: ["users"]})
            fake.userinfo = undefined
            expect(await rp().userinfo("at", "00u-alice")).toBeUndefined()
        })

        test("refuses claims for someone else", async () => {
            fake.userinfo = {sub: "00u-mallory"}
            await expect(rp().userinfo("at", "00u-alice")).rejects.toBeInstanceOf(NOT_AUTHORIZED)
        })

        test("throws when the call fails", async () => {
            fake.userinfo = "broken"
            await expect(rp().userinfo("at", "00u-alice")).rejects.toThrow()
            await expect(rp().userinfo("at", "00u-alice")).rejects.not.toBeInstanceOf(NOT_AUTHORIZED)
        })
    })
})
