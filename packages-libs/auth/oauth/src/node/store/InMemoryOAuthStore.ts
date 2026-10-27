import {errors as oidcErrors} from "oidc-provider"
import {GRANT_BOUND, type GGOAuthPayload, type GGOAuthStore} from "./GGOAuthStore"

type Row = {model: string, id: string, payload: GGOAuthPayload, expiresAt: number | undefined}

// Single-process only (tests, local dev): state is lost on restart and not shared across instances.
export class InMemoryOAuthStore implements GGOAuthStore {

    private readonly rows = new Map<string, Row>()

    private readonly now: () => number

    constructor(now: () => number = Date.now) {
        this.now = now
    }

    public upsert = async (model: string, id: string, payload: GGOAuthPayload, expiresInSec: number | undefined): Promise<void> => {
        this.rows.set(`${model}:${id}`, {model, id, payload, expiresAt: expiresInSec ? this.now() + expiresInSec * 1000 : undefined})
    }

    public find = async (model: string, id: string): Promise<GGOAuthPayload | undefined> => this.live(this.rows.get(`${model}:${id}`))?.payload

    public findByUid = async (model: string, uid: string) => this.findWhere(model, p => p.uid === uid)

    public consume = async (model: string, id: string): Promise<void> => {
        const row = this.rows.get(`${model}:${id}`)
        if (!row) {
            if (model === "AuthorizationCode" || model === "RefreshToken") throw new oidcErrors.InvalidGrant(`${model} revoked`)
            return
        }
        if (row.payload.consumed !== undefined) throw new oidcErrors.InvalidGrant(`${model} already used`)
        row.payload = {...row.payload, consumed: Math.floor(this.now() / 1000)}
    }

    public destroy = async (model: string, id: string): Promise<void> => {
        this.rows.delete(`${model}:${id}`)
    }

    public revokeByGrantId = async (grantId: string): Promise<void> => {
        for (const [key, row] of this.rows) if (GRANT_BOUND.has(row.model) && row.payload.grantId === grantId) this.rows.delete(key)
    }

    public listGrantIds = async (accountId: string): Promise<string[]> =>
        [...this.rows.values()].filter(r => r.model === "Grant" && this.live(r) && r.payload.accountId === accountId).map(r => r.id)

    public destroySessions = async (accountId: string): Promise<void> => {
        for (const [key, row] of this.rows) if (row.model === "Session" && row.payload.accountId === accountId) this.rows.delete(key)
    }

    private findWhere(model: string, match: (p: GGOAuthPayload) => boolean): GGOAuthPayload | undefined {
        for (const row of this.rows.values()) if (row.model === model && this.live(row) && match(row.payload)) return row.payload
        return undefined
    }

    private live(row: Row | undefined): Row | undefined {
        return row && (row.expiresAt === undefined || row.expiresAt > this.now()) ? row : undefined
    }
}
