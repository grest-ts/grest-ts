import type {JWK} from "jose"

// One asymmetric signing key behind a narrow surface, so the private key can live where it can't be
// read (KMS, HSM). Implementations: SecretJwsSigner here; a KMS one in the app.
export interface JwsSigner {
    readonly alg: string
    kid(): Promise<string>
    // Signature over the JWS signing input in JOSE form (ES256: raw r||s, not DER).
    sign(signingInput: Uint8Array): Promise<Uint8Array>
    publicJwk(): Promise<JWK>
}
