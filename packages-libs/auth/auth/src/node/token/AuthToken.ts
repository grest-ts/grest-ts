import {createHash, randomBytes} from "node:crypto"
import {IsArray, IsObject, NOT_AUTHORIZED, type GGSchema} from "@grest-ts/schema"
import type {SigningStrategy} from "../signing/SigningStrategy"
import {IsRefreshTokenRecord, type RefreshTokenStore} from "../refresh/RefreshTokenStore"
import {IsGGAccessTokenData, IsGGRefreshTokenData} from "../../shared/tokenSchemas"
import type {GGAuthTokensResult, GGAuthTokenResult} from "../../shared/tokenSchemas"

export type NoClaims = Record<string, never>

export type AccessPayload<P extends string, C extends object> = C & {
    sub: string
    permissions: P[]
    /** seconds (JWT convention). */
    iat: number
    /** seconds (JWT convention). */
    exp: number
}

export interface AuthTokenOptions<P extends string, C extends object> {
    signer: SigningStrategy
    // Omit for an access-only kind (issueAccess + verifyAccess only); required by issue/refresh/revoke.
    store?: RefreshTokenStore
    // Validates one permission value: IsEnum(MyEnum) for a typed catalogue, or IsString for free-form scopes.
    permission: GGSchema<P>
    // Validates non-permission claims; omit for a permissions-only token.
    claims?: GGSchema<C>
    accessTtlMs: number
    refreshTtlMs: number
    // When set, tokens carry `aud` and verifyAccess rejects a different audience.
    audience?: string
    now?: () => number
    randomToken?: () => string
}

/** What `refresh` re-derives for a subject so a new token reflects current state. */
export interface RefreshedGrant<P extends string, C extends object> {
    permissions: P[]
    claims: C
}

// Generic over permission `P` and claims `C`, and unaware of org/global/tenant.
// A dependency between kinds (e.g. org-token-requires-user-token) is app code
// calling verifyAccess before issue — never modelled here.
export class AuthToken<P extends string, C extends object = NoClaims> {

    private readonly signer: SigningStrategy
    private readonly store: RefreshTokenStore | undefined
    private readonly permissions: GGSchema<P[]>
    private readonly claims: GGSchema<C>
    private readonly accessTtlMs: number
    private readonly refreshTtlMs: number
    private readonly audience: string | undefined
    private readonly now: () => number
    private readonly randomToken: () => string

    constructor(options: AuthTokenOptions<P, C>) {
        this.signer = options.signer
        this.store = options.store
        this.permissions = IsArray(options.permission)
        this.claims = options.claims ?? (IsObject({}) as unknown as GGSchema<C>)
        this.accessTtlMs = options.accessTtlMs
        this.refreshTtlMs = options.refreshTtlMs
        this.audience = options.audience
        this.now = options.now ?? Date.now
        this.randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"))
    }

    public issue = async (subject: string, permissions: P[], claims: C): Promise<GGAuthTokensResult> => {
        return await this.mint(subject, this.permissions.parse(permissions), this.claims.parse(claims), this.randomToken())
    }

    // Mint an access token with no refresh token and no store write. For a secondary/scoped
    // kind re-minted behind a primary token (e.g. an org token), where rotation is the primary
    // token's job. Works with or without a store configured.
    public issueAccess = async (subject: string, permissions: P[], claims: C): Promise<GGAuthTokenResult> => {
        return {
            access: await this.signAccess(subject, this.permissions.parse(permissions), this.claims.parse(claims), this.now())
        }
    }

    public verifyAccess = async (accessToken: string): Promise<AccessPayload<P, C>> => {
        const payload = await this.signer.verify(accessToken)
        const sub = payload["sub"]
        if (typeof sub !== "string") throw new NOT_AUTHORIZED({debugMessage: "TOKEN_INVALID: missing sub"})
        if (this.audience !== undefined && payload["aud"] !== this.audience) {
            throw new NOT_AUTHORIZED({debugMessage: "TOKEN_INVALID: wrong audience"})
        }
        const permissions = this.permissions.parse(payload["permissions"])
        const claims = this.claims.parse(payload)
        return {
            ...(claims as object),
            sub,
            permissions,
            iat: Number(payload["iat"]),
            exp: Number(payload["exp"]),
        } as AccessPayload<P, C>
    }

    // Redeem a refresh token for a fresh pair; the presented token is rotated out (marked
    // spent, same family carried to the child). Re-presenting an already-spent token is
    // reuse — the whole lineage is revoked. `resolve` re-derives permissions/claims so
    // changes take effect on refresh, not just re-login.
    public refresh = async (
        refreshToken: string,
        resolve: (subject: string) => Promise<RefreshedGrant<P, C>>,
    ): Promise<GGAuthTokensResult> => {
        const store = this.requireStore()
        const hash = this.hash(refreshToken)
        const record = await store.find(hash)
        if (!record) throw new NOT_AUTHORIZED({debugMessage: "REFRESH_INVALID"})
        if (record.expiresAt <= this.now()) throw new NOT_AUTHORIZED({debugMessage: "REFRESH_INVALID: expired"})
        if (record.spentAt !== undefined) {
            await store.revokeFamily(record.familyId)
            throw new NOT_AUTHORIZED({debugMessage: "REFRESH_REUSE: refresh token replayed"})
        }
        // markSpent is the atomic single-winner gate: a concurrent second redemption of the
        // same live token loses here and is treated as reuse (strict policy).
        if (!(await store.markSpent(hash, this.now()))) {
            await store.revokeFamily(record.familyId)
            throw new NOT_AUTHORIZED({debugMessage: "REFRESH_REUSE: refresh token used concurrently"})
        }
        try {
            const grant = await resolve(record.subject)
            return await this.mint(record.subject, this.permissions.parse(grant.permissions), this.claims.parse(grant.claims), record.familyId)
        } catch (err) {
            // Grant resolution failed after we spent the token — un-spend it so a transient
            // failure doesn't burn an otherwise-valid session.
            await store.save({...record, spentAt: undefined})
            throw err
        }
    }

    public revoke = async (refreshToken: string): Promise<void> => {
        await this.requireStore().revoke(this.hash(refreshToken))
    }

    public revokeAll = async (subject: string): Promise<void> => {
        await this.requireStore().revokeForSubject(subject)
    }

    private mint = async (subject: string, permissions: P[], claims: C, familyId: string): Promise<GGAuthTokensResult> => {
        const store = this.requireStore()
        const nowMs = this.now()
        const accessToken = await this.signAccess(subject, permissions, claims, nowMs)
        const refreshExpiresAt = nowMs + this.refreshTtlMs
        const refreshToken = this.randomToken()
        await store.save(IsRefreshTokenRecord.parse({
            tokenHash: this.hash(refreshToken),
            subject,
            familyId,
            createdAt: nowMs,
            expiresAt: refreshExpiresAt,
        }))
        return {
            access: accessToken,
            refresh: IsGGRefreshTokenData.parse({
                token: refreshToken,
                expiresAt: refreshExpiresAt
            })
        }
    }

    private signAccess = async (subject: string, permissions: P[], claims: C, nowMs: number): Promise<typeof IsGGAccessTokenData.infer> => {
        const expiresAt = nowMs + this.accessTtlMs
        const token = await this.signer.sign({
            ...(claims as object),
            ...(this.audience !== undefined ? {aud: this.audience} : {}),
            sub: subject,
            permissions,
            iat: Math.floor(nowMs / 1000),
            exp: Math.floor(expiresAt / 1000),
        })
        return IsGGAccessTokenData.parse({token, expiresAt})
    }

    private requireStore = (): RefreshTokenStore => {
        if (!this.store) {
            throw new Error("AuthToken has no RefreshTokenStore: issue/refresh/revoke require one. Use issueAccess for access-only token kinds.")
        }
        return this.store
    }

    private hash = (token: string): string => {
        return createHash("sha256").update(token).digest("base64url")
    }
}
