import type {CreateTableCommandInput} from "@aws-sdk/client-dynamodb"
import {type GGDynamoDb, GGDynamoDbTable} from "@grest-ts/db-dynamodb"
import type {GGLock, GGLockReleaseOptions} from "@grest-ts/lock"
import {IsNumber, IsObject, IsString} from "@grest-ts/schema"

const ROW_TTL_SEC = 24 * 60 * 60
const OWNER = {"#owner": "owner"}

export const IsGGDynamoDbLockRow = IsObject({
    id: IsString,
    /** Absent while a `release({until})` keeps the lock taken by no one. */
    owner: IsString.orUndefined,
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

    acquire(id: string, owner: string, ttlMs: number): Promise<boolean> {
        const now = Date.now()
        return this.table.putConditional(
            this.row(id, owner, now + ttlMs),
            "attribute_not_exists(lockedUntil) OR lockedUntil <= :now",
            {":now": now},
        )
    }

    renew(id: string, owner: string, ttlMs: number): Promise<boolean> {
        const now = Date.now()
        return this.table.putConditional(
            this.row(id, owner, now + ttlMs),
            "#owner = :me AND lockedUntil > :now",
            {":me": owner, ":now": now},
            OWNER,
        )
    }

    async release(id: string, owner: string, options?: GGLockReleaseOptions): Promise<void> {
        const until = options?.until
        if (until !== undefined && until > Date.now()) {
            await this.table.putConditional(this.row(id, undefined, until), "#owner = :me", {":me": owner}, OWNER)
        } else {
            await this.table.deleteConditional(id, "#owner = :me", {":me": owner}, OWNER)
        }
    }

    private row(id: string, owner: string | undefined, lockedUntil: number): GGDynamoDbLockRow {
        return {id, owner, lockedUntil, expiresAtSec: Math.ceil(lockedUntil / 1000) + ROW_TTL_SEC}
    }
}
