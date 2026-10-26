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
        const keys = await this.keySet().catch((err: Error) => { throw err instanceof SERVER_ERROR ? err : unavailable(err) })
        try {
            const {payload} = await jwtVerify(token, keys, {algorithms: this.algorithms})
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
        // A key the last fetched set doesn't have may be a newly published one: can't tell while the JWKS is down.
        const fromStale = async (get: JWTVerifyGetKey, header: Parameters<JWTVerifyGetKey>[0], token: Parameters<JWTVerifyGetKey>[1]) => {
            try {
                return await get(header, token)
            } catch (err) {
                throw err instanceof joseErrors.JWKSNoMatchingKey ? unavailable(err) : err
            }
        }
        return async (header, token) => {
            const fallback = stale()
            // While failing, refetch in the background so no request waits on the fetch timeout.
            if (fallback && failedAt) {
                if (!remote.reloading && Date.now() - failedAt >= RETRY_AFTER_FAILURE_MS) {
                    void remote.reload().then(() => { failedAt = 0 }, () => { failedAt = Date.now() })
                }
                return fromStale(fallback, header, token)
            }
            try {
                return await remote(header, token)
            } catch (err) {
                if (err instanceof joseErrors.JWKSNoMatchingKey || err instanceof joseErrors.JWKSMultipleMatchingKeys) throw err
                failedAt = Date.now()
                if (fallback) return fromStale(fallback, header, token)
                throw unavailable(err as Error)
            }
        }
    }
}

function unavailable(err: Error): Error {
    return new SERVER_ERROR({debugMessage: "JWKS_UNAVAILABLE: " + err.message})
}
