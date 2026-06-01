// The engine owns the claims; a strategy owns only the algorithm + key material.
// Swapping HmacSigner for a KMS/ES256 strategy is a constructor change, no caller impact.
// verify() must check signature + temporal claims and throw NOT_AUTHORIZED on failure.
export interface SigningStrategy {
    sign(claims: Record<string, unknown>): Promise<string>
    verify(token: string): Promise<Record<string, unknown>>
}
