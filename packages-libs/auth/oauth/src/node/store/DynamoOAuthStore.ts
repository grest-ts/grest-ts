import {IsNumber, IsObject, IsString} from "@grest-ts/schema"
import {type GGDynamoDb, GGDynamoDbTable} from "@grest-ts/db-dynamodb"
import {errors as oidcErrors} from "oidc-provider"
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
    /** Epoch seconds; set once (conditional write), so only one of two concurrent redemptions wins. */
    consumedAt: IsNumber.min(0).orUndefined,
    /** Epoch seconds; drives DynamoDB TTL. TTL deletion lags, so reads check it too. */
    expiresAtSec: IsNumber.min(0).orUndefined,
})
type OAuthRow = typeof IsOAuthRow.infer

// Table to create (TTL attribute `expiresAtSec`): HASH `pk` (S), plus GSIs projecting ALL —
// `grantId-index` (grantId), `uid-index` (uid), `accountId-index` (accountId).
// accountId is written only for the models looked up by account, so the index stays small: every
// spent refresh token is kept until expiry (reuse detection) and would otherwise land in it.
const BY_ACCOUNT = new Set(["Grant", "Session"])
const REDEEMABLE = new Set(["AuthorizationCode", "RefreshToken"])

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
            accountId: BY_ACCOUNT.has(model) ? payload.accountId : undefined,
            expiresAtSec: expiresInSec ? Math.floor(Date.now() / 1000) + expiresInSec : undefined,
        })
    }

    public find = async (model: string, id: string): Promise<GGOAuthPayload | undefined> => this.payloadOf(await this.get(`${model}#${id}`))

    public findByUid = async (model: string, uid: string): Promise<GGOAuthPayload | undefined> =>
        this.payloadOf(await this.queryOne("uid-index", "uid = :uid", {":uid": uid, ":model": model}, {filter: "#m = :model", names: {"#m": "model"}}))

    public consume = async (model: string, id: string): Promise<void> => {
        const row = await this.get(`${model}#${id}`)
        if (!row) {
            // A code or refresh token revoked since it was read (e.g. the app was disconnected) must not be redeemed.
            if (REDEEMABLE.has(model)) throw new oidcErrors.InvalidGrant(`${model} revoked`)
            return
        }
        const consumedAt = Math.floor(Date.now() / 1000)
        const payload = JSON.stringify({...JSON.parse(row.payload), consumed: consumedAt})
        // attribute_exists(pk): a row revoked meanwhile stays gone instead of being re-created.
        if (!await this.putConditional({...row, payload, consumedAt}, "attribute_exists(pk) AND attribute_not_exists(consumedAt)")) {
            throw new oidcErrors.InvalidGrant(`${model} already used`)
        }
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

    public listIdsByAccount = async (model: string, accountId: string): Promise<string[]> =>
        (await this.query("accountId-index", "accountId = :a", {":a": accountId, ":model": model}, {filter: "#m = :model", names: {"#m": "model"}}))
            .filter(row => this.live(row)).map(row => row.id)

    private payloadOf(row: OAuthRow | undefined): GGOAuthPayload | undefined {
        return row && this.live(row) ? JSON.parse(row.payload) as GGOAuthPayload : undefined
    }

    private live(row: OAuthRow): boolean {
        return row.expiresAtSec === undefined || row.expiresAtSec > Date.now() / 1000
    }
}
