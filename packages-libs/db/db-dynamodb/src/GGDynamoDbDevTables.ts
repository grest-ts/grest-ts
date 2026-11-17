import {
    CreateTableCommand, DescribeTableCommand, DescribeTimeToLiveCommand, UpdateTableCommand, UpdateTimeToLiveCommand, waitUntilTableExists,
    type CreateTableCommandInput, type DynamoDBClient, type TableDescription, type UpdateTimeToLiveCommandInput,
} from "@aws-sdk/client-dynamodb"
import type {GGDynamoDbTableSpec} from "./GGDynamoDbTableSpec"

export interface GGDynamoDbDevTablesOptions {
    log?: (message: string) => void
    /** How long to wait for an added index to backfill and turn ACTIVE. Default 15 minutes. */
    indexTimeoutMs?: number
}

export interface GGDynamoDbDevTablesResult {
    created: string[]
    /** `<table>/<index>` */
    indexesAdded: string[]
}

/**
 * Tables from specs, for local development, tests and seed scripts only. Production tables belong to the
 * infrastructure code (Terraform or similar): a service must not call this at startup, and nothing here runs on its own.
 */
export class GGDynamoDbDevTables {

    /**
     * Creates each spec's table when it is missing (on-demand billing), adds the GSIs a live table lacks, waiting for each
     * to turn ACTIVE, and turns on the spec's TTL. Add-only: what it can't fix is reported through `log` and left as is
     * — an index the spec no longer declares or declares differently, an LSI on an existing table, TTL on another
     * attribute. Specs naming one table (row kinds sharing it) are merged: they must agree on its key, on the types of
     * the attributes they both index, on same-named indexes and on TTL.
     */
    static async ensure(
        client: DynamoDBClient,
        specs: ReadonlyArray<GGDynamoDbTableSpec<any, any, any, any, any, any>>,
        opts?: GGDynamoDbDevTablesOptions,
    ): Promise<GGDynamoDbDevTablesResult> {
        const log = opts?.log ?? (() => {})
        const result: GGDynamoDbDevTablesResult = {created: [], indexesAdded: []}
        for (const table of merge(specs)) {
            const {input} = table
            if (!await describe(client, table.name)) {
                try {
                    await client.send(new CreateTableCommand({...input, BillingMode: "PAY_PER_REQUEST"}))
                    result.created.push(table.name)
                    log(`created table ${table.name}`)
                } catch (err) {
                    // Another caller sharing the database created it first.
                    if ((err as {name?: string}).name !== "ResourceInUseException") throw err
                }
            }
            // Whoever created it, it is only changed once ACTIVE, and with what is live now.
            await waitUntilTableExists({client, maxWaitTime: 60}, {TableName: table.name})
            const live = (await describe(client, table.name))!
            const declaredTypes = attributeTypes(input.AttributeDefinitions)
            const liveTypes = attributeTypes(live.AttributeDefinitions)
            const differs = (liveIndex: IndexLike, declared: IndexLike) => JSON.stringify(shape(liveIndex, liveTypes)) !== JSON.stringify(shape(declared, declaredTypes))

            const liveGlobal = new Map((live.GlobalSecondaryIndexes ?? []).map(i => [i.IndexName!, i]))
            for (const name of liveGlobal.keys()) {
                if (!input.GlobalSecondaryIndexes?.some(i => i.IndexName === name)) log(`${table.name}: index ${name} is live but not declared; drop it by hand once nothing queries it`)
            }
            for (const index of input.LocalSecondaryIndexes ?? []) {
                const liveIndex = live.LocalSecondaryIndexes?.find(i => i.IndexName === index.IndexName)
                if (!liveIndex) log(`${table.name}: local index ${index.IndexName} is declared but an LSI can only be created with its table`)
                else if (differs(liveIndex, index)) log(`${table.name}: local index ${index.IndexName} is live with other keys or projection than declared; recreate the table by hand`)
            }
            for (const index of input.GlobalSecondaryIndexes ?? []) {
                const liveIndex = liveGlobal.get(index.IndexName!)
                if (liveIndex) {
                    if (differs(liveIndex, index)) log(`${table.name}: index ${index.IndexName} is live with other keys or projection than declared; recreate it by hand`)
                    continue
                }
                log(`${table.name}: adding index ${index.IndexName}`)
                try {
                    await client.send(new UpdateTableCommand({
                        TableName: table.name,
                        // DynamoDB refuses the update unless the new index's key attributes are declared with it.
                        AttributeDefinitions: input.AttributeDefinitions,
                        GlobalSecondaryIndexUpdates: [{Create: {IndexName: index.IndexName!, KeySchema: index.KeySchema!, Projection: index.Projection!}}],
                    }))
                    result.indexesAdded.push(`${table.name}/${index.IndexName}`)
                } catch (err) {
                    // Another caller is adding it: wait for theirs.
                    const now = await describe(client, table.name)
                    if (!now?.GlobalSecondaryIndexes?.some(i => i.IndexName === index.IndexName)) throw err
                }
                await waitForIndex(client, table.name, index.IndexName!, opts?.indexTimeoutMs ?? 15 * 60_000)
            }

            const ttl = table.ttl?.TimeToLiveSpecification!.AttributeName
            if (ttl) {
                const current = (await client.send(new DescribeTimeToLiveCommand({TableName: table.name}))).TimeToLiveDescription
                const status = current?.TimeToLiveStatus
                if (status === "ENABLED" || status === "ENABLING") {
                    if (current?.AttributeName !== ttl) log(`${table.name}: TTL is on ${current?.AttributeName}, the spec says ${ttl}; switch it by hand`)
                } else if (status === "DISABLING") {
                    log(`${table.name}: TTL is still being turned off; run again later to turn it on for ${ttl}`)
                } else {
                    try {
                        await client.send(new UpdateTimeToLiveCommand(table.ttl!))
                        log(`${table.name}: TTL on ${ttl}`)
                    } catch (err) {
                        // Another caller turned it on first.
                        const now = (await client.send(new DescribeTimeToLiveCommand({TableName: table.name}))).TimeToLiveDescription
                        if (now?.AttributeName !== ttl) throw err
                    }
                }
            }
        }
        return result
    }
}

type AnySpec = GGDynamoDbTableSpec<any, any, any, any, any, any>

type Table = {name: string, input: CreateTableCommandInput, ttl: UpdateTimeToLiveCommandInput | undefined}

function merge(specs: ReadonlyArray<AnySpec>): Table[] {
    const tables = new Map<string, Table>()
    for (const spec of specs) {
        const input = spec.createTableInput()
        const table = tables.get(spec.name)
        if (!table) {
            tables.set(spec.name, {name: spec.name, input, ttl: spec.timeToLiveInput()})
            continue
        }
        const fail = (msg: string): never => { throw new Error(`GGDynamoDbDevTables: the specs for "${spec.name}" ${msg}`) }
        const merged = table.input
        for (const a of input.AttributeDefinitions ?? []) {
            const known = merged.AttributeDefinitions!.find(m => m.AttributeName === a.AttributeName)
            if (!known) merged.AttributeDefinitions!.push(a)
            else if (known.AttributeType !== a.AttributeType) fail(`type "${a.AttributeName}" as both ${known.AttributeType} and ${a.AttributeType}`)
        }
        const types = attributeTypes(merged.AttributeDefinitions)
        const same = (a: IndexLike, b: IndexLike) => JSON.stringify(shape(a, types)) === JSON.stringify(shape(b, types))
        if (!same(merged, input)) fail("have different keys")
        for (const kind of ["GlobalSecondaryIndexes", "LocalSecondaryIndexes"] as const) {
            for (const index of input[kind] ?? []) {
                const known = merged[kind]?.find(m => m.IndexName === index.IndexName)
                if (!known) (merged[kind] ??= []).push(index as any)
                else if (!same(known, index)) fail(`declare index ${index.IndexName} differently`)
            }
        }
        const ttl = spec.timeToLiveInput()
        if (ttl && table.ttl && ttl.TimeToLiveSpecification!.AttributeName !== table.ttl.TimeToLiveSpecification!.AttributeName) {
            fail(`put TTL on both ${table.ttl.TimeToLiveSpecification!.AttributeName} and ${ttl.TimeToLiveSpecification!.AttributeName}`)
        }
        table.ttl ??= ttl
    }
    return [...tables.values()]
}

type IndexLike = {KeySchema?: {AttributeName?: string, KeyType?: string}[], Projection?: {ProjectionType?: string, NonKeyAttributes?: string[]}}

function shape(index: IndexLike, types: Map<string | undefined, string | undefined>) {
    return {
        keys: index.KeySchema?.map(k => `${k.AttributeName}:${k.KeyType}:${types.get(k.AttributeName)}`),
        projection: index.Projection?.ProjectionType,
        attributes: [...index.Projection?.NonKeyAttributes ?? []].sort(),
    }
}

function attributeTypes(definitions: {AttributeName?: string, AttributeType?: string}[] | undefined): Map<string | undefined, string | undefined> {
    return new Map((definitions ?? []).map(d => [d.AttributeName, d.AttributeType]))
}

async function describe(client: DynamoDBClient, name: string): Promise<TableDescription | undefined> {
    try {
        return (await client.send(new DescribeTableCommand({TableName: name}))).Table
    } catch (err) {
        if ((err as {name?: string}).name === "ResourceNotFoundException") return undefined
        throw err
    }
}

async function waitForIndex(client: DynamoDBClient, table: string, index: string, timeoutMs: number): Promise<void> {
    const deadline = performance.now() + timeoutMs
    while (performance.now() < deadline) {
        const live = await describe(client, table)
        if (live?.GlobalSecondaryIndexes?.find(i => i.IndexName === index)?.IndexStatus === "ACTIVE") return
        await new Promise(r => setTimeout(r, 2_000))
    }
    throw new Error(`${table}: index ${index} did not turn ACTIVE within ${timeoutMs / 1000}s; run again once it has`)
}
