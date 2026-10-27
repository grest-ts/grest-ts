import {createHash} from "node:crypto"
import {IsNumber, IsObject, IsString} from "@grest-ts/schema"
import {type GGDynamoDb, GGDynamoDbTable} from "@grest-ts/db-dynamodb"
import {errors as oidcErrors} from "oidc-provider"
import {GRANT_BOUND, type GGOAuthPayload, type GGOAuthStore} from "./GGOAuthStore"

const IsOAuthRow = IsObject({
    pk: IsString.nonEmpty,
    model: IsString.nonEmpty,
    /** Grant rows only: a grant id isn't a secret (every token row carries it as grantId). */
    id: IsString.orUndefined,
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

// Rows are keyed by the id's hash: an oidc-provider id is the bearer value itself (refresh token, code, session cookie).
const keyOf = (model: string, id: string) => `${model}#${createHash("sha256").update(id).digest("base64url")}`

export class DynamoOAuthStore extends GGDynamoDbTable<OAuthRow, "pk"> implements GGOAuthStore {

    constructor(db: GGDynamoDb, tableName: string) {
        super(db, tableName, IsOAuthRow, "pk")
    }

    public upsert = async (model: string, id: string, payload: GGOAuthPayload, expiresInSec: number | undefined): Promise<void> => {
        await this.put({
            pk: keyOf(model, id),
            model,
            id: model === "Grant" ? id : undefined,
            // An Interaction copies its login session's id as session.cookie; oidc-provider never reads it back.
            payload: JSON.stringify({...payload, jti: undefined, session: payload.session && {...payload.session as object, cookie: undefined}}),
            grantId: GRANT_BOUND.has(model) ? payload.grantId : undefined,
            uid: payload.uid,
            accountId: BY_ACCOUNT.has(model) ? payload.accountId : undefined,
            expiresAtSec: expiresInSec ? Math.floor(Date.now() / 1000) + expiresInSec : undefined,
        })
    }

    public find = async (model: string, id: string): Promise<GGOAuthPayload | undefined> => {
        const payload = this.payloadOf(await this.get(keyOf(model, id)))
        return payload && {...payload, jti: id}
    }

    public findByUid = async (model: string, uid: string): Promise<GGOAuthPayload | undefined> =>
        this.payloadOf(await this.queryOne("uid-index", "uid = :uid", {":uid": uid, ":model": model}, {filter: "#m = :model", names: {"#m": "model"}}))

    public consume = async (model: string, id: string): Promise<void> => {
        const row = await this.get(keyOf(model, id))
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
        await this.delete(keyOf(model, id))
    }

    public revokeByGrantId = (grantId: string): Promise<void> => this.deleteAll("grantId-index", "grantId = :g", {":g": grantId})

    public listGrantIds = async (accountId: string): Promise<string[]> =>
        (await this.query("accountId-index", "accountId = :a", {":a": accountId, ":model": "Grant"}, {filter: "#m = :model", names: {"#m": "model"}}))
            .filter(row => this.live(row)).map(row => row.id!)

    public destroySessions = (accountId: string): Promise<void> =>
        this.deleteAll("accountId-index", "accountId = :a", {":a": accountId, ":model": "Session"}, {filter: "#m = :model", names: {"#m": "model"}})

    // A long-lived grant accumulates one spent refresh token per rotation (kept for reuse detection), so page.
    private async deleteAll(index: string, condition: string, values: Record<string, unknown>, opts?: {filter: string, names: Record<string, string>}): Promise<void> {
        let cursor: string | undefined
        do {
            const page = await this.queryPage(index, condition, values, {...opts, cursor, limit: 100})
            await Promise.all(page.items.map(row => this.delete(row.pk)))
            cursor = page.cursor
        } while (cursor)
    }

    private payloadOf(row: OAuthRow | undefined): GGOAuthPayload | undefined {
        return row && this.live(row) ? JSON.parse(row.payload) as GGOAuthPayload : undefined
    }

    private live(row: OAuthRow): boolean {
        return row.expiresAtSec === undefined || row.expiresAtSec > Date.now() / 1000
    }
}
