import {describe, it, expect, expectTypeOf, vi} from "vitest"
import {IsArray, IsNumber, IsObject, IsRecord, IsString} from "@grest-ts/schema"
import {GGDynamoDb} from "../src/GGDynamoDb"
import {GGDynamoDbTableSpec} from "../src/GGDynamoDbTableSpec"
import {GGDynamoDbTypedTable} from "../src/GGDynamoDbTypedTable"

const IsUsage = IsObject({
    userId: IsString,
    orgId: IsString,
    provider: IsString,
    day: IsString,
    seconds: IsNumber.orUndefined,
    firstAt: IsNumber.orUndefined,
    purgeAt: IsNumber.orUndefined,
    notes: IsArray(IsString).orUndefined,
    limits: IsObject({daily: IsNumber.orUndefined, monthly: IsNumber.orUndefined}).orUndefined,
    labels: IsRecord(IsString, IsString).orUndefined,
    status: IsString.orUndefined,
})
type Usage = typeof IsUsage.infer

const UsageTable = GGDynamoDbTableSpec.define({
    name: "usage",
    schema: IsUsage,
    pk: "userId",
    sk: "providerDay",
    ttl: "purgeAt",
    derived: d => ({
        providerDay: d.join("orgId", "provider", "day"),
        orgDay: d.string(["orgId", "day"], r => `${r.orgId}@${r.day}`),
    }),
    indexes: {
        byOrgDay: {pk: "orgDay", projection: "KEYS_ONLY"},
        byStatus: {pk: "userId", sk: "status", local: true},
    },
})

const usage: Usage = {userId: "u1", orgId: "o1", provider: "p1", day: "2026-11-12", seconds: 3}

function stubTable(...responses: Record<string, unknown>[]) {
    const send = vi.fn(async (_command: {input: Record<string, any>}) => responses.shift() ?? {Items: []})
    const db = Object.create(GGDynamoDb.prototype) as GGDynamoDb
    Object.assign(db, {client: {send}, config: {name: "test"}})
    const inputs = () => send.mock.calls.map(c => c[0].input)
    return {table: new GGDynamoDbTypedTable(db, UsageTable), inputs}
}

function readable(input: Record<string, any>, expression: string): string {
    return expression
        .replace(/#n\d+/g, n => input.ExpressionAttributeNames[n])
        .replace(/:v\d+/g, v => JSON.stringify(input.ExpressionAttributeValues[v]))
}

function typeOnly(_fn: () => void) {}

describe("a table key derived from its parts", () => {
    it("addresses rows by the parts", async () => {
        const {table, inputs} = stubTable({Item: {...usage, providerDay: "o1#p1#2026-11-12", orgDay: "o1@2026-11-12"}})
        expectTypeOf(table.get).parameter(0).toEqualTypeOf<{userId: string, orgId: string, provider: string, day: string}>()
        await expect(table.get({userId: "u1", orgId: "o1", provider: "p1", day: "2026-11-12"})).resolves.toEqual(usage)
        expect(inputs()[0].Key).toEqual({userId: "u1", providerDay: "o1#p1#2026-11-12"})
    })

    it("put stores the key; update can't change its parts and knows them", async () => {
        const {table, inputs} = stubTable({}, {})
        await table.put(usage)
        expect(inputs()[0].Item).toMatchObject({providerDay: "o1#p1#2026-11-12", orgDay: "o1@2026-11-12"})
        typeOnly(() => {
            // @ts-expect-error the key's parts are fixed once a row exists
            void table.update({userId: "u1", orgId: "o1", provider: "p1", day: "d"}, {orgId: "o2"})
        })
        await expect(table.update({userId: "u1", orgId: "o1", provider: "p1", day: "d"}, {orgId: "o2"} as object)).rejects.toThrow(/"orgId" is part of the table key/)
        await expect(table.update({userId: "u1", orgId: "o1", provider: "p1", day: "d"}, {}, {add: {seconds: 1}})).resolves.toBeUndefined()
        expect(readable(inputs()[1], inputs()[1].UpdateExpression)).toBe("ADD seconds 1")
    })

    it("an upsert writes the key's parts and every derived attribute, from the key", async () => {
        const {table, inputs} = stubTable({})
        await table.update({userId: "u1", orgId: "o1", provider: "p1", day: "d"}, {}, {upsert: true, add: {seconds: 5}, setIfMissing: {firstAt: 100}})
        expect(readable(inputs()[0], inputs()[0].UpdateExpression))
            .toBe(`SET orgId = "o1", provider = "p1", day = "d", firstAt = if_not_exists(firstAt, 100), orgDay = "o1@d" ADD seconds 5`)
        expect(inputs()[0].Key).toEqual({userId: "u1", providerDay: "o1#p1#d"})
        expect(inputs()[0]).not.toHaveProperty("ConditionExpression")
    })

    it("queries the table by a prefix of the parts", async () => {
        const {table, inputs} = stubTable({Items: []}, {Items: []})
        await table.query({userId: "u1"}, {sk: {prefix: {orgId: "o1"}}})
        await table.query({userId: "u1"}, {sk: {prefix: {orgId: "o1", provider: "p1"}}})
        expect(readable(inputs()[0], inputs()[0].KeyConditionExpression)).toBe(`userId = "u1" AND begins_with(providerDay, "o1#")`)
        expect(readable(inputs()[1], inputs()[1].KeyConditionExpression)).toBe(`userId = "u1" AND begins_with(providerDay, "o1#p1#")`)
        await expect(table.query({userId: "u1"}, {sk: {prefix: {provider: "p1"}}})).rejects.toThrow(/takes its leading parts, got provider/)
    })

    it("queries a string-derived key by its inputs, and a KEYS_ONLY index returns the key's parts", async () => {
        const {table, inputs} = stubTable({Items: [{userId: "u1", providerDay: "o1#p1#d", orgDay: "o1@d", orgId: "o1", provider: "p1", day: "d"}]})
        expectTypeOf(table.index.byOrgDay.query).parameter(0).toEqualTypeOf<{orgId: string, day: string}>()
        expectTypeOf(table.index.byOrgDay.query).returns.resolves.toEqualTypeOf<{userId: string, orgId: string, provider: string, day: string}[]>()
        await expect(table.index.byOrgDay.query({orgId: "o1", day: "d"})).resolves.toEqual([{userId: "u1", orgId: "o1", provider: "p1", day: "d"}])
        expect(readable(inputs()[0], inputs()[0].KeyConditionExpression)).toBe(`orgDay = "o1@d"`)
    })

    it("backfill never rewrites the key", async () => {
        const {table, inputs} = stubTable({Items: [{...usage, providerDay: "legacy", orgDay: "o1@2026-11-12"}]})
        await expect(table.backfillPage()).resolves.toMatchObject({scanned: 1, rewritten: 0})
        expect(inputs()).toHaveLength(1)
    })
})

describe("table definition", () => {
    it("generates LSIs, projects the key's parts into KEYS_ONLY indexes, and enables TTL separately", () => {
        const def = UsageTable.createTableInput()
        expect(def.GlobalSecondaryIndexes).toEqual([{
            IndexName: "orgDay-index",
            KeySchema: [{AttributeName: "orgDay", KeyType: "HASH"}],
            Projection: {ProjectionType: "INCLUDE", NonKeyAttributes: ["orgId", "provider", "day"]},
        }])
        expect(def.LocalSecondaryIndexes).toEqual([{
            IndexName: "userId-status-index",
            KeySchema: [{AttributeName: "userId", KeyType: "HASH"}, {AttributeName: "status", KeyType: "RANGE"}],
            Projection: {ProjectionType: "ALL"},
        }])
        expect(UsageTable.timeToLiveInput()).toEqual({TableName: "usage", TimeToLiveSpecification: {AttributeName: "purgeAt", Enabled: true}})
    })

    it("allows consistentRead on a local index only", () => {
        const {table} = stubTable()
        typeOnly(() => {
            void table.index.byStatus.query({userId: "u1"}, {consistentRead: true})
            // @ts-expect-error a GSI is always eventually consistent
            void table.index.byOrgDay.query({orgId: "o", day: "d"}, {consistentRead: true})
        })
    })

    it("rejects a local index on another pk, a non-number ttl, and an unknown table key", () => {
        expect(() => GGDynamoDbTableSpec.define({name: "t", schema: IsUsage, pk: "userId", indexes: {x: {pk: "orgId", sk: "day", local: true}}}))
            .toThrow(/local index "x" needs the table's pk/)
        // @ts-expect-error ttl is a number field
        expect(() => GGDynamoDbTableSpec.define({name: "t", schema: IsUsage, pk: "userId", ttl: "day"})).toThrow(/ttl "day" is not a number field/)
        const unknownKey = () => GGDynamoDbTableSpec.define({name: "t", schema: IsUsage, pk: "nope"})
        expectTypeOf(unknownKey).returns.toEqualTypeOf<`the table key "nope" is neither a field nor derived`>()
        expect(unknownKey).toThrow(/key "nope" is neither a schema field nor derived/)
    })
})

describe("conditions", () => {
    it("compiles ranges, in, beginsWith, contains and size", async () => {
        const {table, inputs} = stubTable({})
        await table.put(usage, {if: {
            seconds: {between: [1, 9]},
            status: {in: ["a", "b"]},
            provider: {beginsWith: "p"},
            notes: {contains: "x"},
            day: {gte: "2026"},
            labels: {size: {lt: 5}},
        }})
        expect(readable(inputs()[0], inputs()[0].ConditionExpression)).toBe(
            `(seconds BETWEEN 1 AND 9 AND status IN ("a", "b") AND begins_with(provider, "p") AND contains(notes, "x") AND day >= "2026" AND size(labels) < 5)`)
        typeOnly(() => {
            // @ts-expect-error ranges are on strings and numbers
            void table.put(usage, {if: {limits: {gt: 1}}})
            // @ts-expect-error contains on a list takes an element
            void table.put(usage, {if: {notes: {contains: 1}}})
        })
    })
})

describe("update expressions", () => {
    const key = {userId: "u1", orgId: "o1", provider: "p1", day: "d"}

    it("appends to a list, merges keys into a map and a record", async () => {
        const {table, inputs} = stubTable({})
        await table.update(key, {}, {append: {notes: ["n"]}, merge: {limits: {daily: 5, monthly: undefined}, labels: {team: "x"}}})
        expect(readable(inputs()[0], inputs()[0].UpdateExpression))
            .toBe(`SET notes = list_append(if_not_exists(notes, []), ["n"]), limits.daily = 5, labels.team = "x" REMOVE limits.monthly`)
    })

    it("validates what it writes and refuses overlapping writes", async () => {
        const {table} = stubTable()
        await expect(table.update(key, {}, {merge: {limits: {weekly: 1} as object}})).rejects.toThrow(/merge "limits": "weekly" is not one of its keys/)
        await expect(table.update(key, {}, {merge: {labels: {a: 1 as unknown as string}}})).rejects.toThrow(/merge "labels.a": schema validation failed/)
        await expect(table.update(key, {}, {merge: {notes: {} as object} as object})).rejects.toThrow(/merge "notes"/)
        await expect(table.update(key, {notes: ["a"]}, {append: {notes: ["b"]}})).rejects.toThrow(/"notes" is written twice \(append\)/)
        await expect(table.update(key, {}, {append: {notes: []}})).rejects.toThrow(/append "notes" needs a list field and a non-empty array/)
        await expect(table.update(key, {}, {setIfMissing: {seconds: "x" as unknown as number}})).rejects.toThrow(/schema validation failed/)
    })
})
