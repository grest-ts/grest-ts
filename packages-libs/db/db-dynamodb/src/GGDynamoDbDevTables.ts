import {
    CreateTableCommand, DescribeTableCommand, DescribeTimeToLiveCommand, UpdateTableCommand, UpdateTimeToLiveCommand, waitUntilTableExists,
    type DynamoDBClient, type TableDescription,
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
     * to turn ACTIVE, and turns on the spec's TTL. Add-only: an index the spec no longer declares is reported, never
     * dropped, and an LSI can't be added to an existing table.
     */
    static async ensure(
        client: DynamoDBClient,
        specs: ReadonlyArray<GGDynamoDbTableSpec<any, any, any, any, any, any>>,
        opts?: GGDynamoDbDevTablesOptions,
    ): Promise<GGDynamoDbDevTablesResult> {
        const log = opts?.log ?? (() => {})
        const result: GGDynamoDbDevTablesResult = {created: [], indexesAdded: []}
        const names = new Set<string>()
        for (const spec of specs) {
            if (names.has(spec.name)) throw new Error(`GGDynamoDbDevTables: two specs name the table "${spec.name}"`)
            names.add(spec.name)
            const input = spec.createTableInput()
            const live = await describe(client, spec.name)
            if (!live) {
                await client.send(new CreateTableCommand({...input, BillingMode: "PAY_PER_REQUEST"}))
                await waitUntilTableExists({client, maxWaitTime: 60}, {TableName: spec.name})
                result.created.push(spec.name)
                log(`created table ${spec.name}`)
            } else {
                const liveIndexes = new Set((live.GlobalSecondaryIndexes ?? []).map(i => i.IndexName))
                for (const name of liveIndexes) {
                    if (!input.GlobalSecondaryIndexes?.some(i => i.IndexName === name)) log(`${spec.name}: index ${name} is live but not declared; drop it by hand once nothing queries it`)
                }
                for (const index of input.LocalSecondaryIndexes ?? []) {
                    if (!(live.LocalSecondaryIndexes ?? []).some(i => i.IndexName === index.IndexName)) log(`${spec.name}: local index ${index.IndexName} is declared but an LSI can only be created with its table`)
                }
                for (const index of input.GlobalSecondaryIndexes ?? []) {
                    if (liveIndexes.has(index.IndexName)) continue
                    log(`${spec.name}: adding index ${index.IndexName}`)
                    await client.send(new UpdateTableCommand({
                        TableName: spec.name,
                        // DynamoDB refuses the update unless the new index's key attributes are declared with it.
                        AttributeDefinitions: input.AttributeDefinitions,
                        GlobalSecondaryIndexUpdates: [{Create: {IndexName: index.IndexName!, KeySchema: index.KeySchema!, Projection: index.Projection!}}],
                    }))
                    await waitForIndex(client, spec.name, index.IndexName!, opts?.indexTimeoutMs ?? 15 * 60_000)
                    result.indexesAdded.push(`${spec.name}/${index.IndexName}`)
                }
            }
            const ttl = spec.timeToLiveInput()
            if (ttl) {
                const current = (await client.send(new DescribeTimeToLiveCommand({TableName: spec.name}))).TimeToLiveDescription
                if (current?.TimeToLiveStatus !== "ENABLED" && current?.TimeToLiveStatus !== "ENABLING") {
                    await client.send(new UpdateTimeToLiveCommand(ttl))
                    log(`${spec.name}: TTL on ${spec.ttl}`)
                }
            }
        }
        return result
    }
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
