import type {CreateTableCommandInput} from "@aws-sdk/client-dynamodb"
import {type GGDynamoDb, GGDynamoDbTable} from "@grest-ts/db-dynamodb"
import type {GGLock} from "@grest-ts/lock"
import {IsNumber, IsObject, IsString} from "@grest-ts/schema"

const ROW_TTL_SEC = 24 * 60 * 60
const OWNER = {"#owner": "owner"}

export const IsGGDynamoDbLockRow = IsObject({
    id: IsString,
    owner: IsString,
    /** Epoch ms. The lock is free from this instant on. */
    lockedUntil: IsNumber,
    /** Epoch seconds, a day past `lockedUntil`: the DynamoDB TTL attribute. */
    expiresAtSec: IsNumber,
})
export type GGDynamoDbLockRow = typeof IsGGDynamoDbLockRow.infer

export interface GGDynamoDbLockOptions {
    /** A table created from `GGDynamoDbLock.tableDefinition(tableName)`. */
    tableName: string
}

/** A `GGLock` shared by every instance using the same table. Each call is one conditional write. */
export class GGDynamoDbLock implements GGLock {

    /** Enable DynamoDB TTL on this attribute, so rows of locks nobody released are eventually deleted. */
    static readonly TTL_ATTRIBUTE = "expiresAtSec"

    static tableDefinition(tableName: string): CreateTableCommandInput {
        return {
            TableName: tableName,
            KeySchema: [{AttributeName: "id", KeyType: "HASH"}],
            AttributeDefinitions: [{AttributeName: "id", AttributeType: "S"}],
        }
    }

    private readonly table: GGDynamoDbTable<GGDynamoDbLockRow, "id">

    constructor(db: GGDynamoDb, options: GGDynamoDbLockOptions) {
        this.table = new GGDynamoDbTable(db, options.tableName, IsGGDynamoDbLockRow, "id")
    }

    acquire(lockId: string, owner: string, ttlMs: number): Promise<boolean> {
        const now = Date.now()
        return this.table.putConditional(
            this.row(lockId, owner, now + ttlMs),
            "attribute_not_exists(lockedUntil) OR lockedUntil <= :now",
            {":now": now},
        )
    }

    renew(lockId: string, owner: string, ttlMs: number): Promise<boolean> {
        const now = Date.now()
        return this.table.putConditional(
            this.row(lockId, owner, now + ttlMs),
            "#owner = :me AND lockedUntil > :now",
            {":me": owner, ":now": now},
            OWNER,
        )
    }

    async release(lockId: string, owner: string): Promise<void> {
        await this.table.deleteConditional(lockId, "#owner = :me", {":me": owner}, OWNER)
    }

    private row(id: string, owner: string, lockedUntil: number): GGDynamoDbLockRow {
        return {id, owner, lockedUntil, expiresAtSec: Math.ceil(lockedUntil / 1000) + ROW_TTL_SEC}
    }
}
