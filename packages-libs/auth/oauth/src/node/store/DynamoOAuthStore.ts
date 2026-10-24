import {IsNumber, IsObject, IsString} from "@grest-ts/schema"
import {type GGDynamoDb, GGDynamoDbTable} from "@grest-ts/db-dynamodb"
import type {GGOAuthPayload, GGOAuthStore} from "./GGOAuthStore"

const IsOAuthRow = IsObject({
    pk: IsString.nonEmpty,
    model: IsString.nonEmpty,
    id: IsString.nonEmpty,
    // oidc-provider's payload as JSON: opaque, nested, may hold undefined values.
    payload: IsString,
    grantId: IsString.orUndefined,
    uid: IsString.orUndefined,
    accountId: IsString.orUndefined,
    /** Epoch seconds; drives DynamoDB TTL. TTL deletion lags, so reads check it too. */
    expiresAtSec: IsNumber.min(0).orUndefined,
})
type OAuthRow = typeof IsOAuthRow.infer

// Table to create (TTL attribute `expiresAtSec`): HASH `pk` (S), plus GSIs projecting ALL —
// `grantId-index` (grantId), `uid-index` (uid), `accountId-index` (accountId).
export const DYNAMO_OAUTH_TABLE_INDEXES = ["grantId-index", "uid-index", "accountId-index"] as const

export class DynamoOAuthStore extends GGDynamoDbTable<OAuthRow, "pk"> implements GGOAuthStore {

    constructor(db: GGDynamoDb, tableName: string) {
        super(db, tableName, IsOAuthRow, "pk")
    }

    public upsert = async (model: string, id: string, payload: GGOAuthPayload, expiresInSec: number | undefined): Promise<void> => {
        await this.put({
            pk: `${model}#${id}`,
            model,
            id,
            payload: JSON.stringify(payload),
            grantId: payload.grantId,
            uid: payload.uid,
            accountId: payload.accountId,
            expiresAtSec: expiresInSec ? Math.floor(Date.now() / 1000) + expiresInSec : undefined,
        })
    }

    public find = async (model: string, id: string): Promise<GGOAuthPayload | undefined> => this.payloadOf(await this.get(`${model}#${id}`))

    public findByUid = async (model: string, uid: string): Promise<GGOAuthPayload | undefined> =>
        this.payloadOf(await this.queryOne("uid-index", "uid = :uid", {":uid": uid, ":model": model}, {filter: "#m = :model", names: {"#m": "model"}}))

    // Device flow is not enabled by GGOAuthServer.
    public findByUserCode = async (): Promise<GGOAuthPayload | undefined> => undefined

    public consume = async (model: string, id: string): Promise<void> => {
        const row = await this.get(`${model}#${id}`)
        if (!row) return
        await this.updateFields(row, {payload: JSON.stringify({...JSON.parse(row.payload), consumed: Math.floor(Date.now() / 1000)})})
    }

    public destroy = async (model: string, id: string): Promise<void> => {
        await this.delete(`${model}#${id}`)
    }

    // A long-lived grant accumulates one spent refresh token per rotation (kept for reuse detection), so page.
    public revokeByGrantId = async (grantId: string): Promise<void> => {
        let cursor: string | undefined
        do {
            const page = await this.queryPage("grantId-index", "grantId = :g", {":g": grantId}, {cursor, limit: 100})
            await Promise.all(page.items.map(row => this.delete(row.pk)))
            cursor = page.cursor
        } while (cursor)
    }

    public listIdsByAccount = async (model: string, accountId: string): Promise<string[]> => {
        const ids: string[] = []
        let cursor: string | undefined
        do {
            const page = await this.queryPage("accountId-index", "accountId = :a", {":a": accountId, ":model": model}, {cursor, filter: "#m = :model", names: {"#m": "model"}})
            for (const row of page.items) if (this.live(row)) ids.push(row.id)
            cursor = page.cursor
        } while (cursor)
        return ids
    }

    private payloadOf(row: OAuthRow | undefined): GGOAuthPayload | undefined {
        return row && this.live(row) ? JSON.parse(row.payload) as GGOAuthPayload : undefined
    }

    private live(row: OAuthRow): boolean {
        return row.expiresAtSec === undefined || row.expiresAtSec > Date.now() / 1000
    }
}
