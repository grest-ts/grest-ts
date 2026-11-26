import {describe, test, expect} from "vitest"
import {generateKeyPairSync, sign as cryptoSign} from "node:crypto"
import {IsObject, IsString} from "@grest-ts/schema"
import {derToJose, GGAuthAccessToken, JwksVerifier, JwsSigningStrategy, KmsJwsSigner, kmsOrSecretJwsSigner, type KmsSigningKey} from "../../index-node"

function fakeKms(keyId: string): KmsSigningKey {
    const {privateKey, publicKey} = generateKeyPairSync("ec", {namedCurve: "P-256"})
    return {
        sign: async ({plaintext}) => cryptoSign("sha256", plaintext, privateKey),
        getPublicKey: async () => ({publicKey: publicKey.export({type: "spki", format: "der"}), keyId}),
    }
}

const claims = IsObject({name: IsString})
const issuer = () => "https://auth.example"

describe("KmsJwsSigner", () => {

    test("a KMS-signed ES256 token verifies with only the published public key", async () => {
        const signer = new KmsJwsSigner(fakeKms("arn:aws:kms:eu-west-1:1:key/abc-123"))
        const issued = await new GGAuthAccessToken({signer: new JwsSigningStrategy(signer), claimSchema: claims, audience: "app-user", issuer}).issue("u1", {name: "Ann"})

        const header = JSON.parse(Buffer.from(issued.token.split(".")[0]!, "base64url").toString())
        expect(header).toEqual({alg: "ES256", kid: "abc-123", typ: "at+jwt"})
        const jwk = await signer.publicJwk()
        expect(jwk).toMatchObject({kty: "EC", crv: "P-256", kid: "abc-123", alg: "ES256", use: "sig"})

        const verifier = new GGAuthAccessToken({signer: new JwksVerifier({jwks: () => [jwk]}), claimSchema: claims, audience: "app-user", issuer})
        expect((await verifier.verify(issued.token)).data).toEqual({name: "Ann"})
    })

    test("derToJose pads short integers and strips DER's sign byte", () => {
        const r = Buffer.concat([Buffer.from([0x00]), Buffer.alloc(32, 0xff)])  // 33 bytes: leading 0x00 for a high bit
        const s = Buffer.from([0x01, 0x02])                                     // 2 bytes: needs left padding
        const der = Buffer.concat([Buffer.from([0x30, 2 + r.length + 2 + s.length, 0x02, r.length]), r, Buffer.from([0x02, s.length]), s])
        const jose = Buffer.from(derToJose(der))
        expect(jose.length).toBe(64)
        expect(jose.subarray(0, 32)).toEqual(Buffer.alloc(32, 0xff))
        expect(jose.subarray(32)).toEqual(Buffer.concat([Buffer.alloc(30), s]))
    })

    test("kmsOrSecretJwsSigner switches key per call", async () => {
        const {privateKey} = generateKeyPairSync("ec", {namedCurve: "P-256"})
        let useKms = true
        const signer = kmsOrSecretJwsSigner({
            kms: fakeKms("key/abc-123"),
            secretJwk: () => JSON.stringify({...privateKey.export({format: "jwk"}), kid: "secret-1"}),
            useKms: () => useKms,
        })
        expect(await signer.kid()).toBe("abc-123")
        useKms = false
        expect(await signer.kid()).toBe("secret-1")
    })
})
