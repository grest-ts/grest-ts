import {describe, test, expect} from "vitest"
import {SignJWT, generateKeyPair, type KeyLike} from "jose"
import {AuthError, OidcIdp, OktaIdp} from "../../index-node"

const ISSUER = "https://example.okta.com/oauth2/default"
const CLIENT = "0oaclient123"

async function oidcToken(privateKey: KeyLike, overrides: {
    issuer?: string
    audience?: string
    expEpochSec?: number
    sub?: string
} = {}) {
    return await new SignJWT({email: "user@corp.com", email_verified: true, name: "Corp User"})
        .setProtectedHeader({alg: "ES256"})
        .setIssuer(overrides.issuer ?? ISSUER)
        .setAudience(overrides.audience ?? CLIENT)
        .setSubject(overrides.sub ?? "okta-sub-1")
        .setExpirationTime(overrides.expEpochSec ?? Math.floor(Date.now() / 1000) + 300)
        .sign(privateKey)
}

describe("OidcIdp (generic OIDC, e.g. Okta)", () => {
    test("verifies a valid ID token and normalizes the identity", async () => {
        const {publicKey, privateKey} = await generateKeyPair("ES256")
        const idp = new OidcIdp({issuer: ISSUER, clientId: CLIENT, keys: async () => publicKey})

        const identity = await idp.authenticate(await oidcToken(privateKey))
        expect(identity).toMatchObject({
            provider: "oidc",
            subject: "okta-sub-1",
            email: "user@corp.com",
            emailVerified: true,
            name: "Corp User",
        })
    })

    test("rejects a token from a different issuer", async () => {
        const {publicKey, privateKey} = await generateKeyPair("ES256")
        const idp = new OidcIdp({issuer: ISSUER, clientId: CLIENT, keys: async () => publicKey})
        const token = await oidcToken(privateKey, {issuer: "https://attacker.example.com"})
        await expect(idp.authenticate(token)).rejects.toMatchObject({code: "TOKEN_INVALID"})
    })

    test("rejects a token for a different audience", async () => {
        const {publicKey, privateKey} = await generateKeyPair("ES256")
        const idp = new OidcIdp({issuer: ISSUER, clientId: "different-client", keys: async () => publicKey})
        await expect(idp.authenticate(await oidcToken(privateKey))).rejects.toMatchObject({code: "TOKEN_INVALID"})
    })

    test("rejects an expired token", async () => {
        const {publicKey, privateKey} = await generateKeyPair("ES256")
        const idp = new OidcIdp({issuer: ISSUER, clientId: CLIENT, keys: async () => publicKey})
        const token = await oidcToken(privateKey, {expEpochSec: Math.floor(Date.now() / 1000) - 60})
        await expect(idp.authenticate(token)).rejects.toBeInstanceOf(AuthError)
    })

    test("OktaIdp labels the identity provider as 'okta'", async () => {
        const {publicKey, privateKey} = await generateKeyPair("ES256")
        const okta = new OktaIdp({issuer: ISSUER, clientId: CLIENT, keys: async () => publicKey})
        const identity = await okta.authenticate(await oidcToken(privateKey))
        expect(identity.provider).toBe("okta")
        expect(identity.subject).toBe("okta-sub-1")
    })
})
