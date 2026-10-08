import {DynamoDBClient, ListTablesCommand} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, ScanCommand} from "@aws-sdk/lib-dynamodb"
import {GGLocator, GGLocatorKey, GGLocatorServiceType} from "@grest-ts/locator"
import {GGLog} from "@grest-ts/logger"
import type {GGDynamoDbConfig, GGDynamoDbHostData, GGDynamoDbUserData} from "./GGDynamoDbConfig"

/** One page of rows plus an opaque continuation token. `cursor` is absent once
 *  the index is exhausted. */
export interface GGDynamoDbPage<T> {
    items: T[]
    cursor: string | undefined
}

// DynamoDB caps a single Query/Scan response at 1MB however many rows match,
// handing back LastEvaluatedKey instead — so one command is never proof of a
// complete result. Ceiling for the calls that drain every page themselves.
const MAX_AUTO_PAGED_ITEMS = 10_000

// The cursor is DynamoDB's LastEvaluatedKey, which callers pass back through an
// API boundary. Encoded so it reads as one opaque string rather than something
// a client might try to construct.
function encodeCursor(key: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(key), "utf8").toString("base64url")
}

/** A cursor that didn't come from `queryPage`/`scanPage`. Its own type because
 *  the value is client-supplied through an API boundary, and the caller should
 *  be able to answer it with "bad request" rather than a 500. */
export class GGDynamoDbCursorError extends Error {
    constructor() {
        super("GGDynamoDb: malformed cursor")
        this.name = "GGDynamoDbCursorError"
    }
}

function decodeCursor(cursor: string): Record<string, unknown> {
    let parsed: unknown
    try {
        parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    } catch {
        throw new GGDynamoDbCursorError()
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new GGDynamoDbCursorError()
    }
    return parsed as Record<string, unknown>
}

/**
 * Follows DynamoDB's pagination to the end, concatenating every page.
 *
 * An explicit `limit` bounds the walk and the result; without one the result is capped at
 * `MAX_AUTO_PAGED_ITEMS` and THROWS past it, because a result set that large is
 * a listing that should be paging rather than one a service holds in memory.
 * `describe` names the caller in that error.
 */
export async function drainPages<T>(
    fetch: (cursor: string | undefined) => Promise<GGDynamoDbPage<T>>,
    limit: number | undefined,
    describe: string,
): Promise<T[]> {
    const items: T[] = []
    let cursor: string | undefined
    do {
        // DynamoDB's `Limit` is per request, so a bounded caller has to shrink
        // it as pages accumulate or page two over-fetches.
        const remaining = limit === undefined ? undefined : limit - items.length
        if (remaining !== undefined && remaining <= 0) break

        const page = await fetch(cursor)
        items.push(...page.items)
        cursor = page.cursor

        // `remaining` rides the request as DynamoDB's `Limit`, but enforce the
        // bound here too: the contract is "at most `limit` rows" regardless of
        // what the source chose to hand back.
        if (limit !== undefined && items.length >= limit) return items.slice(0, limit)

        if (limit === undefined && items.length > MAX_AUTO_PAGED_ITEMS) {
            throw new Error(
                `${describe} exceeded ${MAX_AUTO_PAGED_ITEMS} rows — ` +
                `page it explicitly with queryPage()/scanPage() instead of loading it all`,
            )
        }
    } while (cursor)
    return items
}

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
                region: host?.region ?? "(SDK default)",
                endpoint: host?.endpoint ?? "(default AWS)",
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
            region: host?.region ?? "(SDK default)",
            endpoint: host?.endpoint ?? "(default AWS)",
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

    private buildClient(host: GGDynamoDbHostData | undefined, user: GGDynamoDbUserData | undefined): DynamoDBDocumentClient {
        const endpoint = host?.endpoint
        const explicitCreds = (user?.accessKeyId && user?.secretAccessKey)
            ? {accessKeyId: user.accessKeyId, secretAccessKey: user.secretAccessKey}
            : undefined

        const raw = new DynamoDBClient({
            ...(host?.region && {region: host.region}),
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

        return this.withErrorContext(DynamoDBDocumentClient.from(raw, {
            marshallOptions: {removeUndefinedValues: true},
        }))
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

    /**
     * Installs a middleware that names the db, command, and table on any
     * failure. The raw SDK errors ("Cannot do operations on a non-existent
     * table") omit which table failed — useless in a multi-table service.
     * It lives on the client's shared middleware stack, so it covers both
     * the document operations below and anything built from `getRawClient`.
     * The original error is kept as `cause` ($metadata, requestId, stack)
     * and its `name` is copied across so callers can still branch on it
     * (e.g. `ConditionalCheckFailedException`).
     */
    private withErrorContext<C extends DynamoDBClient | DynamoDBDocumentClient>(client: C): C {
        client.middlewareStack.add(
            (next, context) => async (args) => {
                try {
                    return await next(args)
                } catch (err) {
                    const table = (args.input as {TableName?: string}).TableName
                    if (!table) throw err
                    const msg = err instanceof Error ? err.message : String(err)
                    const wrapped = new Error(`GGDynamoDb '${this.config.name}' ${context.commandName ?? "command"} on table '${table}' failed: ${msg}`, {cause: err})
                    const name = (err as {name?: string}).name
                    if (name) wrapped.name = name
                    throw wrapped
                }
            },
            {step: "initialize", name: "ggTableErrorContext", override: true},
        )
        return client
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
        values?: Record<string, unknown>,
        attributeNames?: Record<string, string>,
    ): Promise<boolean> {
        try {
            await this.getClient().send(new PutCommand({
                TableName: table,
                Item: item as Record<string, unknown>,
                ConditionExpression: conditionExpression,
                // Omit when empty — DynamoDB rejects an empty map, and value-less conditions
                // (e.g. `attribute_not_exists(pk)`) legitimately have no values.
                ...(values && Object.keys(values).length > 0 && {ExpressionAttributeValues: values}),
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

    /**
     * One page of a query, plus the cursor to continue it. Use this for a
     * listing whose caller pages (an API endpoint, a UI list); use `query`
     * when the caller needs the whole result set.
     *
     * `descending` walks the sort key backwards (newest-first on a timestamp
     * SK). A page can come back empty but still carry a `cursor` — follow the
     * cursor, not the item count.
     */
    async queryPage<T>(
        table: string,
        indexName: string | undefined,
        keyCondition: string,
        values: Record<string, unknown>,
        opts?: {limit?: number, descending?: boolean, cursor?: string},
    ): Promise<GGDynamoDbPage<T>> {
        const result = await this.getClient().send(new QueryCommand({
            TableName: table,
            IndexName: indexName,
            KeyConditionExpression: keyCondition,
            ExpressionAttributeValues: values,
            Limit: opts?.limit,
            ...(opts?.descending && {ScanIndexForward: false}),
            ...(opts?.cursor && {ExclusiveStartKey: decodeCursor(opts.cursor)}),
        }))
        return {
            items: (result.Items ?? []) as T[],
            cursor: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : undefined,
        }
    }

    /**
     * Every matching row, following DynamoDB's continuation to the end.
     *
     * An explicit `limit` bounds the walk; without one it is capped at
     * `MAX_AUTO_PAGED_ITEMS` and THROWS past it, because a result set that
     * large is a listing that should be paging (`queryPage`) rather than one
     * hub should hold in memory.
     */
    async query<T>(
        table: string,
        indexName: string | undefined,
        keyCondition: string,
        values: Record<string, unknown>,
        opts?: {limit?: number, descending?: boolean},
    ): Promise<T[]> {
        return drainPages(
            cursor => this.queryPage<T>(table, indexName, keyCondition, values, {
                limit: opts?.limit, descending: opts?.descending, cursor,
            }),
            opts?.limit,
            `GGDynamoDb '${this.config.name}' query on table '${table}'${indexName ? ` index '${indexName}'` : ""}`,
        )
    }

    /** One page of a full-table scan. See `queryPage`. */
    async scanPage<T>(table: string, opts?: {limit?: number, cursor?: string}): Promise<GGDynamoDbPage<T>> {
        const result = await this.getClient().send(new ScanCommand({
            TableName: table,
            Limit: opts?.limit,
            ...(opts?.cursor && {ExclusiveStartKey: decodeCursor(opts.cursor)}),
        }))
        return {
            items: (result.Items ?? []) as T[],
            cursor: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : undefined,
        }
    }

    /** Every row in the table, paged to the end. Capped like `query`. */
    async scan<T>(table: string, opts?: {limit?: number}): Promise<T[]> {
        return drainPages(
            cursor => this.scanPage<T>(table, {limit: opts?.limit, cursor}),
            opts?.limit,
            `GGDynamoDb '${this.config.name}' scan on table '${table}'`,
        )
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
        const endpoint = host?.endpoint
        const explicitCreds = (user?.accessKeyId && user?.secretAccessKey)
            ? {accessKeyId: user.accessKeyId, secretAccessKey: user.secretAccessKey}
            : undefined
        return this.withErrorContext(new DynamoDBClient({
            ...(host?.region && {region: host.region}),
            ...(endpoint && {endpoint}),
            credentials: explicitCreds ?? (endpoint ? {accessKeyId: "local", secretAccessKey: "local"} : undefined),
        }))
    }
}
