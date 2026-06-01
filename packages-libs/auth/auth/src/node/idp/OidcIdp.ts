import {createRemoteJWKSet, jwtVerify, errors as joseErrors, type JWTVerifyGetKey} from "jose"
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import type {ExternalIdentity, IdpStrategy} from "./IdpStrategy"
import {identityFromClaims} from "./identity"

export interface OidcIdpOptions {
    issuer: string
    clientId: string | string[]
    // Label for ExternalIdentity.provider (default "oidc").
    provider?: string
    // Skip discovery and point straight at the JWKS endpoint.
    jwksUri?: string
    // Inject verification keys (tests / custom handling); bypasses discovery.
    keys?: JWTVerifyGetKey
    // Override the discovery URL (default `{issuer}/.well-known/openid-configuration`).
    discoveryUrl?: string
}

// Generic OIDC provider: verifies an ID token (signature vs the issuer's JWKS via
// discovery or jwksUri, iss, aud, not expired) → normalized identity. Okta/Auth0/Entra
// are "just another issuer".
export class OidcIdp implements IdpStrategy<string> {

    public readonly provider: string
    private readonly issuer: string
    private readonly audience: string | string[]
    private readonly options: OidcIdpOptions
    private resolvedKeys: JWTVerifyGetKey | undefined

    constructor(options: OidcIdpOptions) {
        this.options = options
        this.issuer = options.issuer
        this.audience = options.clientId
        this.provider = options.provider ?? "oidc"
    }

    public authenticate = async (idToken: string): Promise<ExternalIdentity> => {
        const keys = await this.keys()
        try {
            const {payload} = await jwtVerify(idToken, keys, {issuer: this.issuer, audience: this.audience})
            return identityFromClaims(this.provider, payload as Record<string, unknown>)
        } catch (err) {
            if (err instanceof NOT_AUTHORIZED) throw err
            if (err instanceof joseErrors.JOSEError) throw new NOT_AUTHORIZED({debugMessage: "TOKEN_INVALID: " + err.message})
            throw err
        }
    }

    private async keys(): Promise<JWTVerifyGetKey> {
        if (this.options.keys) return this.options.keys
        if (this.resolvedKeys) return this.resolvedKeys
        const jwksUri = this.options.jwksUri ?? await this.discoverJwksUri()
        this.resolvedKeys = createRemoteJWKSet(new URL(jwksUri))
        return this.resolvedKeys
    }

    private async discoverJwksUri(): Promise<string> {
        const url = this.options.discoveryUrl ?? `${this.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`
        const res = await fetch(url)
        if (!res.ok) throw new NOT_AUTHORIZED({debugMessage: `TOKEN_INVALID: OIDC discovery failed (${res.status}) at ${url}`})
        const doc = await res.json() as {jwks_uri?: string}
        if (!doc.jwks_uri) throw new NOT_AUTHORIZED({debugMessage: "TOKEN_INVALID: OIDC discovery document has no jwks_uri"})
        return doc.jwks_uri
    }
}
