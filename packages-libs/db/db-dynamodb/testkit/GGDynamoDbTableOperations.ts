import {
    CreateTableCommand,
    DeleteTableCommand,
    DescribeTableCommand,
    DynamoDBClient,
    ListTablesCommand,
    waitUntilTableNotExists,
} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient} from "@aws-sdk/lib-dynamodb"

export interface GGDynamoDbConnection {
    endpoint: string
    region: string
    accessKeyId: string
    secretAccessKey: string
}

/**
 * Low-level table-management primitives the testkit needs to set up + tear
 * down per-test isolated databases.
 *
 * Why "per-test isolated" works without table-name games: dynamodb-local
 * running WITHOUT -sharedDb keeps a separate database file per
 * (accessKeyId, region) pair. The testkit picks a unique accessKey per
 * test group, creates tables under that key, and tears them down after.
 * From the SDK's perspective, every test is talking to a normal DynamoDB
 * with the same table names; the isolation lives one level below.
 */
export class GGDynamoDbTableOperations {

    public readonly client: DynamoDBClient
    public readonly docClient: DynamoDBDocumentClient

    constructor(connection: GGDynamoDbConnection) {
        this.client = new DynamoDBClient({
            endpoint: connection.endpoint,
            region: connection.region,
            credentials: {
                accessKeyId: connection.accessKeyId,
                secretAccessKey: connection.secretAccessKey,
            },
        })
        this.docClient = DynamoDBDocumentClient.from(this.client)
    }

    public destroy(): void {
        this.client.destroy()
    }

    public async listTables(): Promise<string[]> {
        const out: string[] = []
        let exclusiveStartTableName: string | undefined
        do {
            const res = await this.client.send(new ListTablesCommand({ExclusiveStartTableName: exclusiveStartTableName}))
            out.push(...(res.TableNames ?? []))
            exclusiveStartTableName = res.LastEvaluatedTableName
        } while (exclusiveStartTableName)
        return out
    }

    public async describeTable(name: string): Promise<unknown> {
        const res = await this.client.send(new DescribeTableCommand({TableName: name}))
        return res.Table
    }

    /**
     * Drop every table this connection's accessKey can see. Used in afterAll
     * cleanup. -inMemory dynamodb instances would forget on restart anyway,
     * but explicit drops keep the test log clean across runs in the same
     * process and matter for non-inMemory deployments.
     */
    public async dropAllTables(): Promise<void> {
        const names = await this.listTables()
        for (const name of names) {
            await this.client.send(new DeleteTableCommand({TableName: name}))
        }
        // Best-effort wait for each delete to settle. dynamodb-local usually
        // returns instantly, but the SDK contract says deletes are async.
        await Promise.all(names.map(name =>
            waitUntilTableNotExists({client: this.client, maxWaitTime: 30}, {TableName: name}).catch(() => {/* tolerated */}),
        ))
    }
}

export {CreateTableCommand}
