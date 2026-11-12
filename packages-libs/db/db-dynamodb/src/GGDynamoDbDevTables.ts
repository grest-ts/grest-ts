import {
    CreateTableCommand, DescribeTableCommand, DescribeTimeToLiveCommand, UpdateTableCommand, UpdateTimeToLiveCommand, waitUntilTableExists,
    type CreateTableCommandInput, type DynamoDBClient, type TableDescription,
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
        for (const spec of merge(specs)) {
            const {input} = spec
            if (!await describe(client, spec.name)) {
                try {
                    await client.send(new CreateTableCommand({...input, BillingMode: "PAY_PER_REQUEST"}))
                    result.created.push(spec.name)
                    log(`created table ${spec.name}`)
                } catch (err) {
                    // Another caller sharing the database created it first.
                    if ((err as {name?: string}).name !== "ResourceInUseException") throw err
                }
            }
            // Whoever created it, it is only changed once ACTIVE, and with what is live now.
            await waitUntilTableExists({client, maxWaitTime: 60}, {TableName: spec.name})
            const live = (await describe(client, spec.name))!
            const declaredTypes = attributeTypes(input.AttributeDefinitions)
            const liveTypes = attributeTypes(live.AttributeDefinitions)
            const differs = (liveIndex: IndexLike, declared: IndexLike) => JSON.stringify(shape(liveIndex, liveTypes)) !== JSON.stringify(shape(declared, declaredTypes))

            const liveGlobal = new Map((live.GlobalSecondaryIndexes ?? []).map(i => [i.IndexName!, i]))
            for (const name of liveGlobal.keys()) {
                if (!input.GlobalSecondaryIndexes?.some(i => i.IndexName === name)) log(`${spec.name}: index ${name} is live but not declared; drop it by hand once nothing queries it`)
            }
            for (const index of input.LocalSecondaryIndexes ?? []) {
                const liveIndex = live.LocalSecondaryIndexes?.find(i => i.IndexName === index.IndexName)
                if (!liveIndex) log(`${spec.name}: local index ${index.IndexName} is declared but an LSI can only be created with its table`)
                else if (differs(liveIndex, index)) log(`${spec.name}: local index ${index.IndexName} is live with other keys or projection than declared; recreate the table by hand`)
            }
            for (const index of input.GlobalSecondaryIndexes ?? []) {
                const liveIndex = liveGlobal.get(index.IndexName!)
                if (liveIndex) {
                    if (differs(liveIndex, index)) log(`${spec.name}: index ${index.IndexName} is live with other keys or projection than declared; recreate it by hand`)
                    continue
                }
                log(`${spec.name}: adding index ${index.IndexName}`)
                try {
                    await client.send(new UpdateTableCommand({
                        TableName: spec.name,
                        // DynamoDB refuses the update unless the new index's key attributes are declared with it.
                        AttributeDefinitions: input.AttributeDefinitions,
                        GlobalSecondaryIndexUpdates: [{Create: {IndexName: index.IndexName!, KeySchema: index.KeySchema!, Projection: index.Projection!}}],
                    }))
                    result.indexesAdded.push(`${spec.name}/${index.IndexName}`)
                } catch (err) {
                    // Another caller is adding it: wait for theirs.
                    const now = await describe(client, spec.name)
                    if (!now?.GlobalSecondaryIndexes?.some(i => i.IndexName === index.IndexName)) throw err
                }
                await waitForIndex(client, spec.name, index.IndexName!, opts?.indexTimeoutMs ?? 15 * 60_000)
            }

            if (spec.ttl) {
                const current = (await client.send(new DescribeTimeToLiveCommand({TableName: spec.name}))).TimeToLiveDescription
                const status = current?.TimeToLiveStatus
                if (status === "ENABLED" || status === "ENABLING") {
                    if (current?.AttributeName !== spec.ttl) log(`${spec.name}: TTL is on ${current?.AttributeName}, the spec says ${spec.ttl}; switch it by hand`)
                } else if (status === "DISABLING") {
                    log(`${spec.name}: TTL is still being turned off; run again later to turn it on for ${spec.ttl}`)
                } else {
                    try {
                        await client.send(new UpdateTimeToLiveCommand({TableName: spec.name, TimeToLiveSpecification: {AttributeName: spec.ttl, Enabled: true}}))
                        log(`${spec.name}: TTL on ${spec.ttl}`)
                    } catch (err) {
                        // Another caller turned it on first.
                        const now = (await client.send(new DescribeTimeToLiveCommand({TableName: spec.name}))).TimeToLiveDescription
                        if (now?.AttributeName !== spec.ttl) throw err
                    }
                }
            }
        }
        return result
    }
}

type AnySpec = GGDynamoDbTableSpec<any, any, any, any, any, any>

function merge(specs: ReadonlyArray<AnySpec>): {name: string, input: CreateTableCommandInput, ttl: string | undefined}[] {
    const tables = new Map<string, {name: string, input: CreateTableCommandInput, ttl: string | undefined}>()
    for (const spec of specs) {
        const input = spec.createTableInput()
        const table = tables.get(spec.name)
        if (!table) {
            tables.set(spec.name, {name: spec.name, input, ttl: spec.ttl})
            continue
        }
        const fail = (msg: string): never => { throw new Error(`GGDynamoDbDevTables: the specs for "${spec.name}" ${msg}`) }
        const merged = table.input
        if (JSON.stringify(merged.KeySchema) !== JSON.stringify(input.KeySchema)) fail("have different keys")
        for (const a of input.AttributeDefinitions ?? []) {
            const known = merged.AttributeDefinitions!.find(m => m.AttributeName === a.AttributeName)
            if (!known) merged.AttributeDefinitions!.push(a)
            else if (known.AttributeType !== a.AttributeType) fail(`type "${a.AttributeName}" as both ${known.AttributeType} and ${a.AttributeType}`)
        }
        for (const kind of ["GlobalSecondaryIndexes", "LocalSecondaryIndexes"] as const) {
            for (const index of input[kind] ?? []) {
                const known = merged[kind]?.find(m => m.IndexName === index.IndexName)
                if (!known) (merged[kind] ??= []).push(index as any)
                else if (JSON.stringify(known) !== JSON.stringify(index)) fail(`declare index ${index.IndexName} differently`)
            }
        }
        if (spec.ttl && table.ttl && spec.ttl !== table.ttl) fail(`put TTL on both ${table.ttl} and ${spec.ttl}`)
        table.ttl ??= spec.ttl
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
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const live = await describe(client, table)
        if (live?.GlobalSecondaryIndexes?.find(i => i.IndexName === index)?.IndexStatus === "ACTIVE") return
        await new Promise(r => setTimeout(r, 2_000))
    }
    throw new Error(`${table}: index ${index} did not turn ACTIVE within ${timeoutMs / 1000}s; run again once it has`)
}
