import {createRemoteJWKSet, jwtVerify, errors as joseErrors, type JWTVerifyGetKey} from "jose"
import {AuthError} from "../../../errors"
import type {ExternalIdentity, IdpStrategy} from "../../IdpStrategy"
import {identityFromClaims} from "../../identity"

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"]
const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs")

export interface GoogleIdpOptions {
    // OAuth client id(s) the ID token's `aud` must match.
    clientId: string | string[]
    // Verification keys; defaults to Google's remote JWKS. Inject in tests to verify offline.
    keys?: JWTVerifyGetKey
}

// Verifies a Google Identity Services ID token (signature vs Google's JWKS, issuer,
// audience = client id, not expired) → normalized identity.
export class GoogleIdp implements IdpStrategy<string> {

    public readonly provider = "google"
    private readonly keys: JWTVerifyGetKey
    private readonly audience: string | string[]

    constructor(options: GoogleIdpOptions) {
        this.audience = options.clientId
        this.keys = options.keys ?? createRemoteJWKSet(GOOGLE_JWKS_URL)
    }

    public authenticate = async (idToken: string): Promise<ExternalIdentity> => {
        try {
            const {payload} = await jwtVerify(idToken, this.keys, {
                issuer: GOOGLE_ISSUERS,
                audience: this.audience,
            })
            return identityFromClaims(this.provider, payload as Record<string, unknown>)
        } catch (err) {
            if (err instanceof AuthError) throw err
            if (err instanceof joseErrors.JOSEError) throw new AuthError("TOKEN_INVALID", err.message)
            throw err
        }
    }
}
