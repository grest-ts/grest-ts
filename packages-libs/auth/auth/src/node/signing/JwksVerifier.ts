import {createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWK, type JWTVerifyGetKey} from "jose"
import type {SigningStrategy} from "./SigningStrategy"
import {toNotAuthorized} from "./verifyError"

export interface JwksVerifierOptions {
    // The issuer's JWKS URL (fetched on first use and on an unknown kid), or pinned public keys.
    // Resolved per verify, so it may come from config or service discovery.
    jwks: () => string | JWK[] | Promise<string | JWK[]>
    algorithms?: string[]
}

// Verify-only: a service that accepts another service's tokens without holding any key.
export class JwksVerifier implements SigningStrategy {

    private keys: {source: string, get: JWTVerifyGetKey} | undefined
    private readonly options: JwksVerifierOptions
    private readonly algorithms: string[]

    constructor(options: JwksVerifierOptions) {
        this.options = options
        this.algorithms = options.algorithms ?? ["ES256"]
    }

    public sign = async (): Promise<string> => {
        throw new Error("JwksVerifier only verifies; tokens are signed by their issuer")
    }

    public verify = async (token: string): Promise<Record<string, unknown>> => {
        try {
            const {payload} = await jwtVerify(token, await this.keySet(), {algorithms: this.algorithms})
            return payload as Record<string, unknown>
        } catch (err) {
            throw toNotAuthorized(err)
        }
    }

    // Resolved on first use, not at construction: config isn't readable at compose time.
    private async keySet(): Promise<JWTVerifyGetKey> {
        const jwks = await this.options.jwks()
        const source = typeof jwks === "string" ? jwks : JSON.stringify(jwks)
        if (this.keys?.source !== source) {
            this.keys = {
                source,
                get: typeof jwks === "string" ? createRemoteJWKSet(new URL(jwks)) : createLocalJWKSet({keys: jwks}),
            }
        }
        return this.keys.get
    }
}
