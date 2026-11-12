import {DescribeTableCommand, DescribeTimeToLiveCommand, DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {IsNumber, IsObject, IsString} from "@grest-ts/schema"
import {GGDynamoDb} from "../src/GGDynamoDb"
import {GGDynamoDbDevTables} from "../src/GGDynamoDbDevTables"
import {GGDynamoDbTableSpec} from "../src/GGDynamoDbTableSpec"
import {GGDynamoDbTypedTable} from "../src/GGDynamoDbTypedTable"
import {ENDPOINT} from "./TypedTableTestRuntime"

const IsTicket = IsObject({ticketId: IsString, userId: IsString, expiresAt: IsNumber})
const base = {name: "tickets", schema: IsTicket, pk: "ticketId"} as const
const Tickets = GGDynamoDbTableSpec.define(base)
const TicketsWithIndex = GGDynamoDbTableSpec.define({
    ...base,
    ttl: "expiresAt",
    indexes: {byUser: {pk: "userId"}},
})

describe("GGDynamoDbDevTables and GGDynamoDb.forClient against dynamodb-local", () => {
    // Its own access key: dynamodb-local without -sharedDb keeps a database per key.
    const client = new DynamoDBClient({endpoint: ENDPOINT, region: "eu-west-1", credentials: {accessKeyId: `devTables${Date.now()}`, secretAccessKey: "x"}})
    afterAll(() => client.destroy())

    test("creates a table, adds an index and TTL to it later, and leaves it be after that", async () => {
        expect(await GGDynamoDbDevTables.ensure(client, [Tickets])).toEqual({created: ["tickets"], indexesAdded: []})
        const log: string[] = []
        expect(await GGDynamoDbDevTables.ensure(client, [TicketsWithIndex], {log: m => log.push(m)})).toEqual({created: [], indexesAdded: ["tickets/userId-index"]})
        expect(log).toContain("tickets: TTL on expiresAt")
        expect(await GGDynamoDbDevTables.ensure(client, [TicketsWithIndex])).toEqual({created: [], indexesAdded: []})
        const live = (await client.send(new DescribeTableCommand({TableName: "tickets"}))).Table!
        expect(live.GlobalSecondaryIndexes?.map(i => i.IndexName)).toEqual(["userId-index"])
        expect((await client.send(new DescribeTimeToLiveCommand({TableName: "tickets"}))).TimeToLiveDescription?.AttributeName).toBe("expiresAt")
    })

    test("reports what it can't fix: an index declared differently, TTL on another attribute", async () => {
        const Drifted = GGDynamoDbTableSpec.define({...base, ttl: "expiresAt", indexes: {byUser: {pk: "userId", projection: "KEYS_ONLY"}}})
        const OtherTtl = GGDynamoDbTableSpec.define({
            ...base, ttl: "purgeAt", indexes: {byUser: {pk: "userId"}},
            derived: d => ({purgeAt: d.number(["expiresAt"], r => r.expiresAt)}),
        })
        const log: string[] = []
        await GGDynamoDbDevTables.ensure(client, [Drifted], {log: m => log.push(m)})
        await GGDynamoDbDevTables.ensure(client, [OtherTtl], {log: m => log.push(m)})
        expect(log).toEqual([
            "tickets: index userId-index is live with other keys or projection than declared; recreate it by hand",
            "tickets: TTL is on expiresAt, the spec says purgeAt; switch it by hand",
        ])
    })

    test("two callers creating one table (with an index and TTL) at once both succeed", async () => {
        const Races = GGDynamoDbTableSpec.define({name: "races", schema: IsTicket, pk: "ticketId", ttl: "expiresAt", indexes: {byUser: {pk: "userId"}}})
        const results = await Promise.all([GGDynamoDbDevTables.ensure(client, [Races]), GGDynamoDbDevTables.ensure(client, [Races])])
        expect(results.flatMap(r => r.created)).toEqual(["races"])
    })

    test("merges the specs sharing a table", async () => {
        const IsTicketUse = IsObject({ticketId: IsString, usedBy: IsString, at: IsNumber})
        const Uses = GGDynamoDbTableSpec.define({name: "shared", schema: IsTicketUse, pk: "ticketId", indexes: {byUser: {pk: "usedBy"}}})
        const Shared = TicketsWithIndex.withName("shared")
        expect(await GGDynamoDbDevTables.ensure(client, [Shared, Uses])).toEqual({created: ["shared"], indexesAdded: []})
        const live = (await client.send(new DescribeTableCommand({TableName: "shared"}))).Table!
        expect(live.GlobalSecondaryIndexes?.map(i => i.IndexName).sort()).toEqual(["usedBy-index", "userId-index"])
    })

    test("forClient serves a typed table over a client the caller holds", async () => {
        const tickets = new GGDynamoDbTypedTable(GGDynamoDb.forClient(client), TicketsWithIndex)
        await tickets.put({ticketId: "t1", userId: "u1", expiresAt: 1})
        expect(await tickets.index.byUser.query({userId: "u1"})).toEqual([{ticketId: "t1", userId: "u1", expiresAt: 1}])
    })
})
