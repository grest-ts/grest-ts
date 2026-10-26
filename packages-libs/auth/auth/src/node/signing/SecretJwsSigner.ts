import {createPrivateKey, createPublicKey, sign as cryptoSign, type KeyObject} from "node:crypto"
import {calculateJwkThumbprint, type JWK} from "jose"
import type {JwsSigner} from "./JwsSigner"

// A private JWK (EC P-256 → ES256, OKP Ed25519 → EdDSA) held as a secret. Read on every op so a
// rotated secret applies without a restart; the keys are re-derived only when it changes.
export class SecretJwsSigner implements JwsSigner {

    public readonly alg: string
    private readonly reveal: () => string
    private derived: {secret: string, privateKey: KeyObject, publicJwk: JWK & {kid: string}} | undefined

    constructor(privateJwk: string | (() => string), alg: "ES256" | "EdDSA" = "ES256") {
        this.reveal = typeof privateJwk === "function" ? privateJwk : () => privateJwk
        this.alg = alg
    }

    public kid = async (): Promise<string> => (await this.keys()).publicJwk.kid

    public sign = async (signingInput: Uint8Array): Promise<Uint8Array> => {
        const {privateKey} = await this.keys()
        return this.alg === "ES256"
            ? cryptoSign("sha256", signingInput, {key: privateKey, dsaEncoding: "ieee-p1363"})
            : cryptoSign(null, signingInput, privateKey)
    }

    public publicJwk = async (): Promise<JWK> => (await this.keys()).publicJwk

    private async keys(): Promise<NonNullable<SecretJwsSigner["derived"]>> {
        const secret = this.reveal()
        if (this.derived?.secret !== secret) {
            const jwk = JSON.parse(secret) as JWK
            const privateKey = createPrivateKey({key: jwk as Record<string, string>, format: "jwk"})
            const publicJwk = createPublicKey(privateKey).export({format: "jwk"}) as JWK
            const kid = typeof jwk.kid === "string" ? jwk.kid : await calculateJwkThumbprint(publicJwk)
            this.derived = {secret, privateKey, publicJwk: {...publicJwk, alg: this.alg, use: "sig", kid}}
        }
        return this.derived
    }
}
