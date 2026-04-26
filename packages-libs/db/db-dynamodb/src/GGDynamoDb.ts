import {DynamoDBClient, ListTablesCommand} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, ScanCommand} from "@aws-sdk/lib-dynamodb"
import {GGLocator, GGLocatorKey, GGLocatorServiceType} from "@grest-ts/locator"
import {GGLog} from "@grest-ts/logger"
import type {GGDynamoDbConfig, GGDynamoDbHostData, GGDynamoDbUserData} from "./GGDynamoDbConfig"

/**
 * DynamoDB connection — owns the SDK client, exposes raw `get/put/...`
 * primitives. Schema-bound table operations live on `GGDynamoDbTable`.
 *
 * Lifecycle: constructor registers with the runtime locator and
 * subscribes to host/user config changes. `start()` builds the client
 * and verifies access with a cheap `ListTables` call — misconfigured
 * credentials, wrong region, or an unreachable endpoint surface as a
 * startup failure rather than as a mysterious request error five
 * minutes later. `teardown()` destroys the client and unwatches.
 *
 * Unlike mysql/postgres there's no connection pool — the SDK client is
 * just an HTTP-config holder, so a config change rebuilds it from
 * scratch (cheap; no pool to drain).
 */
export class GGDynamoDb {

    public readonly token: GGLocatorKey<GGDynamoDb>

    private readonly config: GGDynamoDbConfig
    private started = false
    private client: DynamoDBDocumentClient | undefined
    private unwatchHost: (() => void) | undefined
    private unwatchUser: (() => void) | undefined

    constructor(config: GGDynamoDbConfig) {
        this.config = config
        this.token = config.token

        this.unwatchHost = config.host.watch(() => this.connect().catch(() => {}))
        this.unwatchUser = config.user.watch(() => this.connect().catch(() => {}))

        GGLocator.getScope().setWithLifecycle(config.token, this, {
            type: GGLocatorServiceType.DATABASE,
            start: () => this.start(),
            teardown: () => this.teardown(),
        })
    }

    private async connect(): Promise<void> {
        if (!this.started) {
            return
        }

        const host = this.config.host.get()
        const user = this.config.user.reveal()

        const newClient = this.buildClient(host, user)
        try {
            await newClient.send(new ListTablesCommand({Limit: 1}))
        } catch (err) {
            newClient.destroy()
            const msg = err instanceof Error ? err.message : String(err)
            GGLog.critical(this, "Failed to connect to DynamoDB!", {
                name: this.config.name,
                region: host.region,
                endpoint: host.endpoint || "(default AWS)",
                error: msg,
            })
            throw new Error(`GGDynamoDb '${this.config.name}' connect failed: ${msg}`)
        }

        if (this.client) {
            this.client.destroy()
        }
        this.client = newClient

        GGLog.info(this, "DynamoDB connected", {
            name: this.config.name,
            region: host.region,
            endpoint: host.endpoint || "(default AWS)",
        })
    }

    private async start(): Promise<void> {
        this.started = true
        await this.connect()
    }

    private async teardown(): Promise<void> {
        this.unwatchHost?.()
        this.unwatchHost = undefined
        this.unwatchUser?.()
        this.unwatchUser = undefined
        if (this.client) {
            this.client.destroy()
            this.client = undefined
            GGLog.debug(this, "DynamoDB disconnected", {name: this.config.name})
        }
        this.started = false
    }

    private buildClient(host: GGDynamoDbHostData, user: GGDynamoDbUserData): DynamoDBDocumentClient {
        const endpoint = host.endpoint
        const explicitCreds = (user.accessKeyId && user.secretAccessKey)
            ? {accessKeyId: user.accessKeyId, secretAccessKey: user.secretAccessKey}
            : undefined

        const raw = new DynamoDBClient({
            region: host.region,
            ...(endpoint && {endpoint}),
            ...(explicitCreds && {credentials: explicitCreds}),
            // Dev-mode safety net: when an endpoint is set (dynamodb-local /
            // localstack) and no credentials were passed in, supply
            // placeholders so the SDK doesn't reach for the real default
            // chain and hang trying to talk to IMDS.
            ...(endpoint && !explicitCreds && {
                credentials: {accessKeyId: "local", secretAccessKey: "local"},
            }),
        })

        return DynamoDBDocumentClient.from(raw, {
            marshallOptions: {removeUndefinedValues: true},
        })
    }

    private getClient(): DynamoDBDocumentClient {
        if (!this.client) {
            throw new Error(
                `GGDynamoDb '${this.config.name}' not connected. ` +
                `Are you calling this before runtime.start()?`,
            )
        }
        return this.client
    }

    async get<T>(table: string, key: Record<string, unknown>): Promise<T | undefined> {
        const result = await this.getClient().send(new GetCommand({TableName: table, Key: key}))
        return result.Item as T | undefined
    }

    async put(table: string, item: object): Promise<void> {
        await this.getClient().send(new PutCommand({
            TableName: table,
            Item: item as Record<string, unknown>,
        }))
    }

    /**
     * Conditional put. Returns true on success, false when the condition
     * fails (another writer beat us). Any other error is rethrown.
     *
     * `attributeNames` is needed when the condition references reserved
     * DDB keywords (`version`, `name`, `status`, ...). Use placeholders
     * like `#v` in the expression and map them in `attributeNames`.
     */
    async putConditional(
        table: string,
        item: object,
        conditionExpression: string,
        values: Record<string, unknown>,
        attributeNames?: Record<string, string>,
    ): Promise<boolean> {
        try {
            await this.getClient().send(new PutCommand({
                TableName: table,
                Item: item as Record<string, unknown>,
                ConditionExpression: conditionExpression,
                ExpressionAttributeValues: values,
                ...(attributeNames && {ExpressionAttributeNames: attributeNames}),
            }))
            return true
        } catch (err) {
            if ((err as {name?: string}).name === "ConditionalCheckFailedException") return false
            throw err
        }
    }

    async delete(table: string, key: Record<string, unknown>): Promise<void> {
        await this.getClient().send(new DeleteCommand({TableName: table, Key: key}))
    }

    async query<T>(
        table: string,
        indexName: string | undefined,
        keyCondition: string,
        values: Record<string, unknown>,
        opts?: {limit?: number},
    ): Promise<T[]> {
        const result = await this.getClient().send(new QueryCommand({
            TableName: table,
            IndexName: indexName,
            KeyConditionExpression: keyCondition,
            ExpressionAttributeValues: values,
            Limit: opts?.limit,
        }))
        return (result.Items ?? []) as T[]
    }

    async scan<T>(table: string): Promise<T[]> {
        const result = await this.getClient().send(new ScanCommand({TableName: table}))
        return (result.Items ?? []) as T[]
    }

    /**
     * Escape hatch — exposes a fresh raw low-level client (no
     * DocumentClient marshalling). Used for table-create / admin
     * operations that the document layer doesn't cover. Reads config at
     * call time, so it works before `start()` has run — useful for seed
     * scripts that create tables before any data exists.
     */
    getRawClient(): DynamoDBClient {
        const host = this.config.host.get()
        const user = this.config.user.reveal()
        const endpoint = host.endpoint
        const explicitCreds = (user.accessKeyId && user.secretAccessKey)
            ? {accessKeyId: user.accessKeyId, secretAccessKey: user.secretAccessKey}
            : undefined
        return new DynamoDBClient({
            region: host.region,
            ...(endpoint && {endpoint}),
            credentials: explicitCreds ?? (endpoint ? {accessKeyId: "local", secretAccessKey: "local"} : undefined),
        })
    }
}
