import type {CreateTableCommandInput, DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {DeleteCommand, DynamoDBDocumentClient, UpdateCommand} from "@aws-sdk/lib-dynamodb"
import type {GGJobLock} from "@grest-ts/job"

const ROW_TTL_SEC = 24 * 60 * 60
const TTL_ATTRIBUTE = "expiresAtSec"
const NAMES = {"#owner": "owner", "#exp": TTL_ATTRIBUTE}

export interface GGJobDynamoDbLockOptions {
    /** A table created from `GGJobDynamoDbLock.tableDefinition(tableName)`. */
    tableName: string
    now?: () => number
}

/**
 * One row per lock id: `owner` + `lockedUntil` while held, `lastRunAt` once an `exclusive` run finished.
 * A held row also carries `expiresAtSec`, a day past its lease: enable DynamoDB TTL on that attribute so a crashed
 * holder's row (an `item` row lock, typically) is eventually deleted. A finished run's `lastRunAt` row has none and stays.
 */
export class GGJobDynamoDbLock implements GGJobLock {

    /** Enable DynamoDB TTL on this attribute. */
    static readonly TTL_ATTRIBUTE = TTL_ATTRIBUTE

    static tableDefinition(tableName: string): CreateTableCommandInput {
        return {
            TableName: tableName,
            KeySchema: [{AttributeName: "id", KeyType: "HASH"}],
            AttributeDefinitions: [{AttributeName: "id", AttributeType: "S"}],
        }
    }

    private readonly db: {getRawClient(): DynamoDBClient}
    private readonly tableName: string
    private readonly now: () => number
    private doc: DynamoDBDocumentClient | undefined

    /** Takes the client on first use: GGDynamoDb's config can't be read at compose time. */
    constructor(db: {getRawClient(): DynamoDBClient}, options: GGJobDynamoDbLockOptions) {
        this.db = db
        this.tableName = options.tableName
        this.now = options.now ?? Date.now
    }

    async acquire(id: string, owner: string, ttlMs: number, lastRunAtMost?: number): Promise<boolean> {
        const now = this.now()
        const due = lastRunAtMost === undefined ? "" : " AND (attribute_not_exists(lastRunAt) OR lastRunAt <= :most)"
        return this.conditional(new UpdateCommand({
            TableName: this.tableName,
            Key: {id},
            UpdateExpression: "SET #owner = :me, lockedUntil = :until, #exp = :exp",
            ConditionExpression: "(attribute_not_exists(lockedUntil) OR lockedUntil <= :now)" + due,
            ExpressionAttributeNames: NAMES,
            ExpressionAttributeValues: {
                ":me": owner, ":now": now, ":until": now + ttlMs, ":exp": this.expiresAtSec(now + ttlMs),
                ...(lastRunAtMost === undefined ? {} : {":most": lastRunAtMost}),
            },
        }))
    }

    renew(id: string, owner: string, ttlMs: number): Promise<boolean> {
        const now = this.now()
        const until = now + ttlMs
        return this.conditional(new UpdateCommand({
            TableName: this.tableName,
            Key: {id},
            UpdateExpression: "SET lockedUntil = :until, #exp = :exp",
            ConditionExpression: "#owner = :me AND lockedUntil > :now",
            ExpressionAttributeNames: NAMES,
            ExpressionAttributeValues: {":me": owner, ":now": now, ":until": until, ":exp": this.expiresAtSec(until)},
        }))
    }

    async release(id: string, owner: string, ranAt?: number): Promise<void> {
        await this.conditional(ranAt === undefined
            ? new DeleteCommand({
                TableName: this.tableName,
                Key: {id},
                ConditionExpression: "#owner = :me",
                ExpressionAttributeNames: {"#owner": "owner"},
                ExpressionAttributeValues: {":me": owner},
            })
            : new UpdateCommand({
                TableName: this.tableName,
                Key: {id},
                UpdateExpression: "SET lastRunAt = :ranAt REMOVE #owner, lockedUntil, #exp",
                ConditionExpression: "#owner = :me",
                ExpressionAttributeNames: NAMES,
                ExpressionAttributeValues: {":me": owner, ":ranAt": ranAt},
            }))
    }

    private expiresAtSec(lockedUntil: number): number {
        return Math.ceil(lockedUntil / 1000) + ROW_TTL_SEC
    }

    private async conditional(command: UpdateCommand | DeleteCommand): Promise<boolean> {
        try {
            await this.client().send(command as UpdateCommand)
            return true
        } catch (err) {
            if ((err as {name?: string}).name === "ConditionalCheckFailedException") return false
            throw err
        }
    }

    private client(): DynamoDBDocumentClient {
        // getRawClient() builds a new SDK client on every call, so it must be taken once.
        this.doc ??= DynamoDBDocumentClient.from(this.db.getRawClient())
        return this.doc
    }
}
