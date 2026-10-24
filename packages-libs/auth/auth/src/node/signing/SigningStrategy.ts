// The engine owns the claims; a strategy owns only the algorithm + key material.
// Swapping HmacSigner for a KMS/ES256 strategy is a constructor change, no caller impact.
// verify() must check signature + temporal claims and throw NOT_AUTHORIZED on failure.
export interface SigningStrategy {
    sign(claims: Record<string, unknown>): Promise<string>
    verify(token: string): Promise<Record<string, unknown>>
    // Raw JWS key for a third-party signer (e.g. an OAuth server) that must mint tokens this
    // strategy verifies. Optional: a KMS-backed strategy can't hand out its key.
    jwsKey?(): {alg: string, key: Uint8Array}
}
