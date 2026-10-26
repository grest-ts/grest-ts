import {createPrivateKey, createPublicKey, sign as cryptoSign, type KeyObject} from "node:crypto"
import {calculateJwkThumbprint, type JWK} from "jose"
import type {JwsSigner} from "./JwsSigner"

// A private JWK (EC P-256 → ES256, OKP Ed25519 → EdDSA) held as a secret. Read on every op so a
// rotated secret applies without a restart.
export class SecretJwsSigner implements JwsSigner {

    public readonly alg: string
    private readonly reveal: () => string

    constructor(privateJwk: string | (() => string), alg: "ES256" | "EdDSA" = "ES256") {
        this.reveal = typeof privateJwk === "function" ? privateJwk : () => privateJwk
        this.alg = alg
    }

    public kid = async (): Promise<string> => {
        const jwk = this.jwk()
        return typeof jwk.kid === "string" ? jwk.kid : await calculateJwkThumbprint(publicPart(jwk))
    }

    public sign = async (signingInput: Uint8Array): Promise<Uint8Array> => {
        const key = this.privateKey()
        return this.alg === "ES256"
            ? cryptoSign("sha256", signingInput, {key, dsaEncoding: "ieee-p1363"})
            : cryptoSign(null, signingInput, key)
    }

    public publicJwk = async (): Promise<JWK> => ({
        ...createPublicKey(this.privateKey()).export({format: "jwk"}),
        alg: this.alg, use: "sig", kid: await this.kid(),
    })

    private jwk(): JWK {
        return JSON.parse(this.reveal()) as JWK
    }

    private privateKey(): KeyObject {
        return createPrivateKey({key: this.jwk() as Record<string, string>, format: "jwk"})
    }
}

function publicPart(jwk: JWK): JWK {
    const {d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, ...pub} = jwk
    return pub
}
