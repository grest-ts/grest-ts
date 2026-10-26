import type {JWK} from "jose"

// verify() must check signature + temporal claims and throw NOT_AUTHORIZED on failure.
export interface TokenVerifier {
    verify(token: string): Promise<Record<string, unknown>>
}

// The engine owns the claims; a signer owns only the algorithm + key material.
// Swapping HmacSigner for a KMS/ES256 signer is a constructor change, no caller impact.
export interface TokenSigner extends TokenVerifier {
    sign(claims: Record<string, unknown>): Promise<string>
    // Public keys a verifier needs (served as the issuer's JWKS). Absent for symmetric signers.
    publicJwks?(): Promise<JWK[]>
}
