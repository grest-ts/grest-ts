import {type GGSchema, IsObject, NOT_AUTHORIZED} from "@grest-ts/schema"
import type {TokenSigner, TokenVerifier} from "../signing/TokenSigner"
import {GGAccessTokenData, GGAuthSubject, IsGGAccessTokenData} from "../../shared/tokenSchemas"

export type GGAccessPayload<C extends object> = {
    data: C
    sub: GGAuthSubject
    /** seconds (JWT convention). */
    iat: number
    /** seconds (JWT convention). */
    exp: number
    /** seconds; when the user signed in (OIDC auth_time), if the issuer recorded it. */
    auth_time?: number
}

export interface GGAuthAccessTokenOptions<C extends object, S extends TokenVerifier = TokenSigner> {
    // A TokenSigner issues and verifies; a verify-only TokenVerifier (JwksVerifier) makes a token
    // that can't issue, and calling issue() on it is a compile error.
    signer: S
    // Validates the app claims carried under `data`; omit for a token with no claims.
    claimSchema?: GGSchema<C>
    // Access token lifetime. Defaults to 30 min — short-lived by design, paired with
    // rotating refresh so expiry is seamless. Override for stricter/looser policy.
    accessTtlMs?: number
    // When set, tokens carry `aud` and verifyAccess rejects a different audience.
    audience?: string
    // When set, tokens carry `iss` and verify rejects another issuer. Read per call (config).
    issuer?: () => string
    now?: () => number
}

// Signs/verifies the stateless access token: claims ride under `data`, with the registered
// `sub`/`iat`/`exp`/`aud` claims as the envelope. Claims are opaque to the engine — it
// validates them against claimSchema and nothing more. GGAuthRefreshToken composes one of
// these for the access half of a rotating pair.
export class GGAuthAccessToken<C extends object, S extends TokenVerifier = TokenSigner> {

    public readonly signer: S
    private readonly claims: GGSchema<C>
    public readonly accessTtlMs: number
    public readonly audience: string | undefined
    public readonly issuer: (() => string) | undefined
    private readonly now: () => number

    constructor(options: GGAuthAccessTokenOptions<C, S>) {
        this.signer = options.signer
        this.claims = options.claimSchema ?? (IsObject({}) as unknown as GGSchema<C>)
        this.accessTtlMs = options.accessTtlMs ?? 30 * 60 * 1000
        this.audience = options.audience
        this.issuer = options.issuer
        this.now = options.now ?? Date.now
    }

    // `unknown` rather than `never` when S can't sign, so a signing token still fits where a
    // verify-only one is expected (GGAuthAccessToken<C, TokenVerifier>).
    // `authTime`: when the subject signed in (epoch seconds), carried as `auth_time`.
    public readonly issue = (async (subject: string | GGAuthSubject, claims: C, opts?: {authTime?: number}): Promise<GGAccessTokenData> => {
        return await this.sign(subject as GGAuthSubject, claims, this.now(), opts?.authTime)
    }) as S extends TokenSigner ? (subject: string | GGAuthSubject, claims: C, opts?: {authTime?: number}) => Promise<GGAccessTokenData> : unknown

    public verify = async (accessToken: string): Promise<GGAccessPayload<C>> => {
        const payload = await this.signer.verify(accessToken)
        const sub = payload["sub"]
        if (typeof sub !== "string") throw new NOT_AUTHORIZED({debugMessage: "TOKEN_INVALID: missing sub"})
        if (this.audience !== undefined && payload["aud"] !== this.audience) {
            throw new NOT_AUTHORIZED({debugMessage: "TOKEN_INVALID: wrong audience"})
        }
        if (this.issuer && payload["iss"] !== this.issuer()) {
            throw new NOT_AUTHORIZED({debugMessage: "TOKEN_INVALID: wrong issuer"})
        }
        const claims = this.claims.parse(payload["data"])
        return {
            data: Object.freeze(claims),
            sub,
            iat: Number(payload["iat"]),
            exp: Number(payload["exp"]),
            ...(typeof payload["auth_time"] === "number" ? {auth_time: payload["auth_time"]} : {}),
        } as GGAccessPayload<C>
    }

    // The `data` claim value for these claims — for an external minter (OAuth server) that signs
    // the envelope itself but must produce exactly what verify() parses.
    public encodeClaims = (claims: C): C => this.claims.parse(claims)

    // Parses the claims then signs. Public so GGAuthRefreshToken can mint the access half of a
    // rotating pair through the same code path.
    public readonly _sign = ((subject: GGAuthSubject, claims: C, nowMs: number) =>
        this.sign(subject, claims, nowMs)
    ) as S extends TokenSigner ? (subject: GGAuthSubject, claims: C, nowMs: number) => Promise<GGAccessTokenData> : unknown

    private sign = async (subject: GGAuthSubject, claims: C, nowMs: number, authTime?: number): Promise<GGAccessTokenData> => {
        const expiresAt = nowMs + this.accessTtlMs
        // Only reachable through issue/_sign, whose types require S to be a TokenSigner.
        const token = await (this.signer as TokenVerifier as TokenSigner).sign({
            data: this.claims.parse(claims),
            ...(this.audience !== undefined ? {aud: this.audience} : {}),
            ...(this.issuer ? {iss: this.issuer()} : {}),
            sub: subject,
            iat: Math.floor(nowMs / 1000),
            exp: Math.floor(expiresAt / 1000),
            ...(authTime !== undefined ? {auth_time: authTime} : {}),
        })
        return IsGGAccessTokenData.parse({token, expiresAt})
    }
}
