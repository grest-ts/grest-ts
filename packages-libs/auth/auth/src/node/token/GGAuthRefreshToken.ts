import {createHash, randomBytes} from "node:crypto"
import {NOT_AUTHORIZED, NOT_FOUND} from "@grest-ts/schema"
import {IsRefreshTokenRecord, type RefreshTokenStore} from "../refresh/RefreshTokenStore"
import {GGAuthSubject, GGAuthTokensResult, IsGGRefreshTokenData} from "../../shared/tokenSchemas"
import {GGAuthAccessToken} from "./GGAuthAccessToken"

export interface GGAuthRefreshTokenOptions<C extends object> {
    // Required by issue/refresh/revoke. For an access-only kind, use GGAuthAccessToken directly.
    store: RefreshTokenStore
    refreshTtlMs: number
    now?: () => number
    randomToken?: () => string
    // The access half of the rotating pair — owns the claim schema, signing and verification.
    access: GGAuthAccessToken<C>
}

// Adds rotation + reuse-detection + revocation on top of a GGAuthAccessToken. Claims stay
// opaque: minting/verifying is delegated to the composed access token, this class only owns
// the refresh lifecycle. A dependency between kinds (e.g. org-token-requires-user-token) is
// app code calling verifyAccess before issue — never modelled here.
export class GGAuthRefreshToken<C extends object> {

    private readonly store: RefreshTokenStore | undefined
    private readonly refreshTtlMs: number
    private readonly now: () => number
    private readonly randomToken: () => string
    public readonly access: GGAuthAccessToken<C>

    constructor(options: GGAuthRefreshTokenOptions<C>) {
        this.store = options.store
        this.refreshTtlMs = options.refreshTtlMs
        this.now = options.now ?? Date.now
        this.randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"))
        this.access = options.access
    }
    
    public issue = async (subject: string | GGAuthSubject, claims: C): Promise<GGAuthTokensResult> => {
        return await this.mint(subject as GGAuthSubject, claims, this.randomToken())
    }

    // Redeem a refresh token for a fresh pair; the presented token is rotated out (marked
    // spent, same family carried to the child). Re-presenting an already-spent token is
    // reuse — the whole lineage is revoked. `resolve` re-derives the claims so changes
    // take effect on refresh, not just re-login.
    public refresh = async (
        refreshToken: string,
        resolve: (subject: string) => Promise<C | undefined>,
    ): Promise<GGAuthTokensResult> => {
        const hash = this.hash(refreshToken)
        const record = await this.store.find(hash)
        if (!record) throw new NOT_AUTHORIZED({debugMessage: "REFRESH_INVALID"})
        if (record.expiresAt <= this.now()) throw new NOT_AUTHORIZED({debugMessage: "REFRESH_INVALID: expired"})
        if (record.spentAt !== undefined) {
            await this.store.revokeFamily(record.familyId)
            throw new NOT_AUTHORIZED({debugMessage: "REFRESH_REUSE: refresh token replayed"})
        }
        // markSpent is the atomic single-winner gate: a concurrent second redemption of the
        // same live token loses here and is treated as reuse (strict policy).
        if (!(await this.store.markSpent(hash, this.now()))) {
            await this.store.revokeFamily(record.familyId)
            throw new NOT_AUTHORIZED({debugMessage: "REFRESH_REUSE: refresh token used concurrently"})
        }
        try {
            const claims = await resolve(record.subject)
            if (!claims) throw new NOT_FOUND()
            return await this.mint(record.subject, claims, record.familyId)
        } catch (err) {
            // Grant resolution failed after we spent the token — un-spend it so a transient
            // failure doesn't burn an otherwise-valid session.
            await this.store.save({...record, spentAt: undefined})
            throw err
        }
    }

    public revoke = async (refreshToken: string): Promise<void> => {
        await this.store.revoke(this.hash(refreshToken))
    }

    public revokeAll = async (subject: string | GGAuthSubject): Promise<void> => {
        await this.store.revokeForSubject(subject as GGAuthSubject)
    }

    private mint = async (subject: GGAuthSubject, claims: C, familyId: string): Promise<GGAuthTokensResult> => {
        const nowMs = this.now()
        const accessToken = await this.access._sign(subject, claims, nowMs)
        const refreshExpiresAt = nowMs + this.refreshTtlMs
        const refreshToken = this.randomToken()
        await this.store.save(IsRefreshTokenRecord.parse({
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

    private hash = (token: string): string => {
        return createHash("sha256").update(token).digest("base64url")
    }
}
