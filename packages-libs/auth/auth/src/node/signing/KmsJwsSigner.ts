import {createPublicKey} from "node:crypto"
import type {JWK} from "jose"
import type {JwsSigner} from "./JwsSigner"
import {SecretJwsSigner} from "./SecretJwsSigner"

/** What it needs of a KMS client on an ECC P-256 signing key (AWS KMS: `ECDSA_SHA_256`). */
export interface KmsSigningKey {
    /** DER-encoded ECDSA signature over SHA-256 of `plaintext`. */
    sign(args: {plaintext: Buffer}): Promise<Buffer>
    /** SPKI DER, and the key's canonical id (its ARN, whatever it was configured by). */
    getPublicKey(): Promise<{publicKey: Buffer, keyId: string}>
}

/** ES256 JWS signing with a KMS key: the private key never leaves KMS. */
export class KmsJwsSigner implements JwsSigner {

    public readonly alg = "ES256"
    private readonly kms: KmsSigningKey

    constructor(kms: KmsSigningKey) {
        this.kms = kms
    }

    kid = async (): Promise<string> => kmsKeyKid((await this.kms.getPublicKey()).keyId)

    sign = async (signingInput: Uint8Array): Promise<Uint8Array> =>
        derToJose(await this.kms.sign({plaintext: Buffer.from(signingInput)}))

    publicJwk = async (): Promise<JWK> => {
        const {publicKey, keyId} = await this.kms.getPublicKey()
        const jwk = createPublicKey({key: publicKey, format: "der", type: "spki"}).export({format: "jwk"})
        return {
            ...jwk,
            alg: this.alg,
            use: "sig",
            kid: kmsKeyKid(keyId),
        }
    }
}

/** JWT `kid` for a KMS key's canonical id: the id after the last `/`, so a key ARN publishes its UUID, not the account. */
export function kmsKeyKid(keyId: string): string {
    return keyId.slice(keyId.lastIndexOf("/") + 1)
}

/** KMS returns ECDSA signatures as DER `SEQUENCE {INTEGER r, INTEGER s}`; JWS wants raw r||s, 32 bytes each. */
export function derToJose(der: Buffer): Uint8Array {
    let i = der[1] & 0x80 ? 2 + (der[1] & 0x7f) : 2
    const integer = (): Buffer => {
        if (der[0] !== 0x30 || der[i] !== 0x02) throw new Error("KMS returned a malformed ECDSA signature")
        const length = der[i + 1]
        const value = der.subarray(i + 2, i + 2 + length)
        i += 2 + length
        return value
    }
    const out = Buffer.alloc(64)
    for (const [offset, value] of [[0, integer()], [32, integer()]] as const) {
        const trimmed = value.subarray(Math.max(0, value.length - 32))
        trimmed.copy(out, offset + 32 - trimmed.length)
    }
    return out
}

/** ES256 with a KMS key or a private JWK held as a secret, chosen per call (config isn't readable at compose time). */
export function kmsOrSecretJwsSigner(opts: {kms: KmsSigningKey, secretJwk: () => string, useKms: () => boolean}): JwsSigner {
    const kms = new KmsJwsSigner(opts.kms)
    const secret = new SecretJwsSigner(opts.secretJwk)
    const active = () => opts.useKms() ? kms : secret
    return {
        alg: "ES256",
        kid: () => active().kid(),
        sign: input => active().sign(input),
        publicJwk: () => active().publicJwk(),
    }
}
