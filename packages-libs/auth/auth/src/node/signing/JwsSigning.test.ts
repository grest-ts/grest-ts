import {describe, test, expect, afterAll} from "vitest"
import {createServer} from "node:http"
import type {AddressInfo} from "node:net"
import {generateKeyPairSync} from "node:crypto"
import {IsArray, IsObject, IsString, NOT_AUTHORIZED} from "@grest-ts/schema"
import {GGAuthAccessToken, HmacSigner, JwksVerifier, JwsSigningStrategy, SecretJwsSigner, type TokenVerifier} from "../../index-node"

const IsClaims = IsObject({permissions: IsArray(IsString)})
const ISSUER = "https://auth.example"

function newKey(type: "ec" | "ed25519" = "ec"): string {
    const {privateKey} = type === "ec"
        ? generateKeyPairSync("ec", {namedCurve: "P-256"})
        : generateKeyPairSync("ed25519")
    return JSON.stringify(privateKey.export({format: "jwk"}))
}

function token<S extends TokenVerifier>(signer: S, issuer = ISSUER) {
    return new GGAuthAccessToken({signer, claimSchema: IsClaims, audience: "app-user", issuer: () => issuer})
}

async function expectAuthError(p: Promise<unknown>, code: string): Promise<void> {
    const err = await p.then(() => undefined, (e: unknown) => e)
    expect(err).toBeInstanceOf(NOT_AUTHORIZED)
    expect((err as InstanceType<typeof NOT_AUTHORIZED>).getDebugContext()?.debugMessage).toContain(code)
}

describe("JwsSigningStrategy + SecretJwsSigner", () => {
    test("ES256 token round-trips with iss, aud and an at+jwt header carrying the kid", async () => {
        const signer = new SecretJwsSigner(newKey())
        const issued = await token(new JwsSigningStrategy(signer)).issue("alice", {permissions: ["read"]})
        const header = JSON.parse(Buffer.from(issued.token.split(".")[0]!, "base64url").toString())
        expect(header).toEqual({alg: "ES256", kid: await signer.kid(), typ: "at+jwt"})

        const payload = await token(new JwsSigningStrategy(signer)).verify(issued.token)
        expect(payload.sub).toBe("alice")
        expect(payload.data).toEqual({permissions: ["read"]})
    })

    test("EdDSA works the same way", async () => {
        const strategy = new JwsSigningStrategy(new SecretJwsSigner(newKey("ed25519"), "EdDSA"))
        const issued = await token(strategy).issue("alice", {permissions: []})
        expect((await token(strategy).verify(issued.token)).sub).toBe("alice")
    })

    test("another issuer's token is rejected", async () => {
        const strategy = new JwsSigningStrategy(new SecretJwsSigner(newKey()))
        const issued = await token(strategy, "https://evil.example").issue("alice", {permissions: []})
        await expectAuthError(token(strategy).verify(issued.token), "wrong issuer")
    })

    test("rotation: a published next key verifies before it signs, the old one after it stops", async () => {
        const oldKey = new SecretJwsSigner(newKey())
        const nextKey = new SecretJwsSigner(newKey())
        const beforeSwitch = new JwsSigningStrategy(oldKey, () => [nextKey])
        const afterSwitch = new JwsSigningStrategy(nextKey, () => [oldKey])

        const oldToken = await token(beforeSwitch).issue("alice", {permissions: []})
        const newToken = await token(afterSwitch).issue("alice", {permissions: []})
        expect((await token(beforeSwitch).verify(newToken.token)).sub).toBe("alice")
        expect((await token(afterSwitch).verify(oldToken.token)).sub).toBe("alice")
        await expectAuthError(token(new JwsSigningStrategy(nextKey)).verify(oldToken.token), "TOKEN_INVALID")
    })

    test("the published JWKS carries no private part", async () => {
        const [jwk] = await new JwsSigningStrategy(new SecretJwsSigner(newKey())).publicJwks()
        expect(jwk).toMatchObject({kty: "EC", crv: "P-256", alg: "ES256", use: "sig"})
        expect(jwk).not.toHaveProperty("d")
    })
})

describe("JwksVerifier", () => {
    const signer = new SecretJwsSigner(newKey())
    const issuing = new JwsSigningStrategy(signer)
    let fetches = 0
    const server = createServer(async (_req, res) => {
        fetches++
        res.writeHead(200, {"content-type": "application/json"})
        res.end(JSON.stringify({keys: await issuing.publicJwks()}))
    })
    const listening = new Promise<string>(resolve => server.listen(0, () => resolve(`http://localhost:${(server.address() as AddressInfo).port}/jwks`)))
    afterAll(() => new Promise(resolve => server.close(resolve)))

    test("verifies against the issuer's remote JWKS, holding no key", async () => {
        const url = await listening
        const verifier = new JwksVerifier({jwks: () => url})
        const issued = await token(issuing).issue("alice", {permissions: ["read"]})
        expect((await token(verifier).verify(issued.token)).data).toEqual({permissions: ["read"]})
        expect((await token(verifier).verify(issued.token)).sub).toBe("alice")
        expect(fetches).toBe(1)
    })

    test("verifies against pinned keys", async () => {
        const keys = await issuing.publicJwks()
        const issued = await token(issuing).issue("alice", {permissions: []})
        expect((await token(new JwksVerifier({jwks: () => keys})).verify(issued.token)).sub).toBe("alice")
    })

    test("rejects a token signed by a key the issuer doesn't publish", async () => {
        const stranger = new JwsSigningStrategy(new SecretJwsSigner(newKey()))
        const issued = await token(stranger).issue("alice", {permissions: []})
        const keys = await issuing.publicJwks()
        await expectAuthError(token(new JwksVerifier({jwks: () => keys})).verify(issued.token), "TOKEN_INVALID")
    })

    test("a verify-only token has no issue() at compile time; a signing one fits where a verifier is expected", () => {
        const verifying = token(new JwksVerifier({jwks: () => []}))
        // @ts-expect-error — JwksVerifier can't sign
        void (() => verifying.issue("alice", {permissions: []}))
        const audienceOf = (t: GGAuthAccessToken<typeof IsClaims.infer, TokenVerifier>) => t.audience
        expect([audienceOf(verifying), audienceOf(token(issuing)), audienceOf(token(new HmacSigner("k")))]).toEqual(["app-user", "app-user", "app-user"])
    })
})
