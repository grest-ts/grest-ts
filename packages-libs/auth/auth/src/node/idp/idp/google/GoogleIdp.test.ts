import {describe, test, expect} from "vitest"
import {SignJWT, generateKeyPair, type JWTVerifyGetKey, type KeyLike} from "jose"
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {GoogleIdp} from "../../../../index-node"

const CLIENT_ID = "client-123.apps.googleusercontent.com"

async function googleToken(privateKey: KeyLike, overrides: {
    issuer?: string
    audience?: string
    expEpochSec?: number
    sub?: string
} = {}) {
    const builder = new SignJWT({email: "user@example.com", email_verified: true, name: "Test User"})
        .setProtectedHeader({alg: "ES256"})
        .setIssuer(overrides.issuer ?? "https://accounts.google.com")
        .setAudience(overrides.audience ?? CLIENT_ID)
        .setSubject(overrides.sub ?? "google-sub-1")
    builder.setExpirationTime(overrides.expEpochSec ?? Math.floor(Date.now() / 1000) + 300)
    return await builder.sign(privateKey)
}

describe("GoogleIdp", () => {
    test("verifies a valid Google ID token and normalizes the identity", async () => {
        const {publicKey, privateKey} = await generateKeyPair("ES256")
        const getKey: JWTVerifyGetKey = async () => publicKey
        const idp = new GoogleIdp({clientId: CLIENT_ID, keys: getKey})

        const identity = await idp.authenticate(await googleToken(privateKey))
        expect(identity).toMatchObject({
            provider: "google",
            subject: "google-sub-1",
            email: "user@example.com",
            emailVerified: true,
            name: "Test User",
        })
    })

    test("rejects a token for a different audience (client id)", async () => {
        const {publicKey, privateKey} = await generateKeyPair("ES256")
        const idp = new GoogleIdp({clientId: "some-other-client", keys: async () => publicKey})
        await expect(idp.authenticate(await googleToken(privateKey)))
            .rejects.toBeInstanceOf(NOT_AUTHORIZED)
    })

    test("rejects a token from a different issuer", async () => {
        const {publicKey, privateKey} = await generateKeyPair("ES256")
        const idp = new GoogleIdp({clientId: CLIENT_ID, keys: async () => publicKey})
        const token = await googleToken(privateKey, {issuer: "https://evil.example.com"})
        await expect(idp.authenticate(token)).rejects.toBeInstanceOf(NOT_AUTHORIZED)
    })

    test("rejects an expired token", async () => {
        const {publicKey, privateKey} = await generateKeyPair("ES256")
        const idp = new GoogleIdp({clientId: CLIENT_ID, keys: async () => publicKey})
        const token = await googleToken(privateKey, {expEpochSec: Math.floor(Date.now() / 1000) - 60})
        await expect(idp.authenticate(token)).rejects.toBeInstanceOf(NOT_AUTHORIZED)
    })

    test("rejects a token signed by an unknown key", async () => {
        const trusted = await generateKeyPair("ES256")
        const attacker = await generateKeyPair("ES256")
        const idp = new GoogleIdp({clientId: CLIENT_ID, keys: async () => trusted.publicKey})
        await expect(idp.authenticate(await googleToken(attacker.privateKey)))
            .rejects.toBeInstanceOf(NOT_AUTHORIZED)
    })
})
