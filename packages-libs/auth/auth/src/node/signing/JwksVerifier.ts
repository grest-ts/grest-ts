import {createLocalJWKSet, createRemoteJWKSet, errors as joseErrors, jwksCache, jwtVerify, type ExportedJWKSCache, type JWK, type JWTVerifyGetKey} from "jose"
import {SERVER_ERROR} from "@grest-ts/schema"
import type {TokenVerifier} from "./TokenSigner"
import {toNotAuthorized} from "./verifyError"

export interface JwksVerifierOptions {
    // The issuer's JWKS URL (fetched on first use, every 10 minutes and on an unknown kid), or pinned
    // public keys. Resolved per verify, so it may come from config or service discovery.
    jwks: () => string | JWK[] | Promise<string | JWK[]>
    algorithms?: string[]
    // While the JWKS URL can't be fetched, the last fetched key set keeps verifying for this long
    // after it was fetched. Past it (or with nothing fetched yet) verify throws SERVER_ERROR, not NOT_AUTHORIZED.
    maxStaleMs?: number
}

const RETRY_AFTER_FAILURE_MS = 30_000

// Verify-only: a service that accepts another service's tokens without holding any key.
export class JwksVerifier implements TokenVerifier {

    private keys: {source: string, get: JWTVerifyGetKey} | undefined
    private readonly options: JwksVerifierOptions
    private readonly algorithms: string[]

    constructor(options: JwksVerifierOptions) {
        this.options = options
        this.algorithms = options.algorithms ?? ["ES256"]
    }

    public verify = async (token: string): Promise<Record<string, unknown>> => {
        try {
            const {payload} = await jwtVerify(token, await this.keySet(), {algorithms: this.algorithms})
            return payload as Record<string, unknown>
        } catch (err) {
            if (err instanceof SERVER_ERROR) throw err
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
                get: typeof jwks === "string" ? this.remoteKeys(jwks) : createLocalJWKSet({keys: jwks}),
            }
        }
        return this.keys.get
    }

    // jose's remote set refetches once its cache is 10 minutes old and fails every verify while that
    // fetch fails, so an issuer outage would read as every token being invalid.
    private remoteKeys(url: string): JWTVerifyGetKey {
        const fetched: Partial<ExportedJWKSCache> = {}
        const remote = createRemoteJWKSet(new URL(url), {[jwksCache]: fetched as ExportedJWKSCache})
        const maxStaleMs = this.options.maxStaleMs ?? 24 * 3600_000
        let lastGood: {uat: number, get: JWTVerifyGetKey} | undefined
        let failedAt = 0
        const stale = (): JWTVerifyGetKey | undefined => {
            if (!fetched.jwks || fetched.uat === undefined || Date.now() - fetched.uat >= maxStaleMs) return undefined
            if (lastGood?.uat !== fetched.uat) lastGood = {uat: fetched.uat, get: createLocalJWKSet(fetched.jwks)}
            return lastGood.get
        }
        return async (header, token) => {
            const fallback = stale()
            if (fallback && Date.now() - failedAt < RETRY_AFTER_FAILURE_MS) return fallback(header, token)
            try {
                return await remote(header, token)
            } catch (err) {
                if (err instanceof joseErrors.JWKSNoMatchingKey || err instanceof joseErrors.JWKSMultipleMatchingKeys) throw err
                failedAt = Date.now()
                if (fallback) return fallback(header, token)
                throw new SERVER_ERROR({debugMessage: "JWKS_UNAVAILABLE: " + (err as Error).message})
            }
        }
    }
}
