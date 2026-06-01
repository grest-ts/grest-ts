import {type GGSchema, IsObject, NOT_AUTHORIZED} from "@grest-ts/schema"
import type {SigningStrategy} from "../signing/SigningStrategy"
import {GGAuthSubject, GGAuthTokenResult, IsGGAccessTokenData} from "../../shared/tokenSchemas"

export type GGAccessPayload<C extends object> = {
    data: C
    sub: GGAuthSubject
    /** seconds (JWT convention). */
    iat: number
    /** seconds (JWT convention). */
    exp: number
}

export interface GGAuthAccessTokenOptions<C extends object> {
    signer: SigningStrategy
    // Validates non-permission claims; omit for a permissions-only token.
    claimSchema?: GGSchema<C>
    accessTtlMs: number
    // When set, tokens carry `aud` and verifyAccess rejects a different audience.
    audience?: string
    now?: () => number
}

export class GGAuthAccessToken<C extends object> {

    private readonly signer: SigningStrategy
    private readonly claims: GGSchema<C>
    private readonly accessTtlMs: number
    private readonly audience: string | undefined
    private readonly now: () => number

    constructor(options: GGAuthAccessTokenOptions<C>) {
        this.signer = options.signer
        this.claims = options.claimSchema ?? (IsObject({}) as unknown as GGSchema<C>)
        this.accessTtlMs = options.accessTtlMs
        this.audience = options.audience
        this.now = options.now ?? Date.now
    }

    public issueAccess = async (subject: string | GGAuthSubject, claims: C): Promise<GGAuthTokenResult> => {
        return {
            access: await this.signAccess(subject as GGAuthSubject, this.claims.parse(claims), this.now())
        }
    }

    public verifyAccess = async (accessToken: string): Promise<GGAccessPayload<C>> => {
        const payload = await this.signer.verify(accessToken)
        const sub = payload["sub"]
        if (typeof sub !== "string") throw new NOT_AUTHORIZED({debugMessage: "TOKEN_INVALID: missing sub"})
        if (this.audience !== undefined && payload["aud"] !== this.audience) {
            throw new NOT_AUTHORIZED({debugMessage: "TOKEN_INVALID: wrong audience"})
        }
        const claims = this.claims.parse(payload)
        return {
            data: claims,
            sub,
            iat: Number(payload["iat"]),
            exp: Number(payload["exp"]),
        } as GGAccessPayload<C>
    }

    public signAccess = async (subject: GGAuthSubject, claims: C, nowMs: number): Promise<typeof IsGGAccessTokenData.infer> => {
        const expiresAt = nowMs + this.accessTtlMs
        const token = await this.signer.sign({
            data: claims,
            ...(this.audience !== undefined ? {aud: this.audience} : {}),
            sub: subject,
            iat: Math.floor(nowMs / 1000),
            exp: Math.floor(expiresAt / 1000),
        })
        return IsGGAccessTokenData.parse({token, expiresAt})
    }
}
