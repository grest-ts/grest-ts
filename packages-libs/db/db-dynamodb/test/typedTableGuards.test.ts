import {describe, it, expect, vi} from "vitest"
import {IsArray, IsNumber, IsObject, IsString} from "@grest-ts/schema"
import {GGDynamoDb} from "../src/GGDynamoDb"
import {GGDynamoDbTableSpec} from "../src/GGDynamoDbTableSpec"
import {GGDynamoDbTypedTable} from "../src/GGDynamoDbTypedTable"

const IsEvent = IsObject({
    userId: IsString,
    at: IsNumber,
    kind: IsString,
    orgId: IsString,
    note: IsString.orUndefined,
    tags: IsArray(IsString).orUndefined,
    meta: IsObject({a: IsString.orUndefined}).orUndefined,
})

// `second` buckets `at`: several `at`s share one key, so the key's input is pinned on every update.
const EventsTable = GGDynamoDbTableSpec.define({
    name: "events",
    schema: IsEvent,
    pk: "userId",
    sk: "second",
    sets: ["tags"],
    derived: d => ({
        second: d.number(["at"], r => Math.floor(r.at / 1000)),
        orgKind: d.join("orgId", "kind"),
        byNote: d.join("note"),
    }),
    indexes: {
        byOrgKind: {pk: "orgKind", sk: "second"},
        byNote: {pk: "byNote"},
        byOrg: {pk: "orgId", sk: "orgKind"},
    },
})

const event = {userId: "u1", at: 1500, kind: "k", orgId: "o1"}

function stubTable(...responses: (Record<string, unknown> | Error)[]) {
    const send = vi.fn(async (_command: {input: Record<string, any>}) => {
        const response = responses.shift() ?? {Items: []}
        if (response instanceof Error) throw response
        return response
    })
    const db = Object.create(GGDynamoDb.prototype) as GGDynamoDb
    Object.assign(db, {client: {send}, config: {name: "test"}})
    const inputs = () => send.mock.calls.map(c => c[0].input)
    return {table: new GGDynamoDbTypedTable(db, EventsTable), inputs}
}

function readable(input: Record<string, any>, expression: string): string {
    return expression
        .replace(/#n\d+/g, n => input.ExpressionAttributeNames[n])
        .replace(/:v\d+/g, v => JSON.stringify(input.ExpressionAttributeValues[v], (_k, x) => x instanceof Set ? {set: [...x]} : x))
}

function typeOnly(_fn: () => void) {}

describe("conditions", () => {
    it("take exactly one operator per field", async () => {
        const {table, inputs} = stubTable()
        typeOnly(() => {
            // @ts-expect-error one operator per field
            void table.put(event, {if: {orgId: {exists: true, eq: "o2"}}})
        })
        await expect(table.put(event, {if: {orgId: {exists: true, eq: "o2"} as never}})).rejects.toThrow(/the condition on "orgId" needs exactly one operator, got exists, eq/)
        await expect(table.put(event, {if: {at: {}} as never})).rejects.toThrow(/needs exactly one operator, got none/)
        expect(inputs()).toHaveLength(0)
    })

    it("send operands on a set field as a set", async () => {
        const {table, inputs} = stubTable({})
        await table.put(event, {if: {tags: {eq: ["a"]}}})
        expect(readable(inputs()[0], inputs()[0].ConditionExpression)).toBe(`tags = {"set":["a"]}`)
    })
})

describe("join keys", () => {
    it("refuse a part containing the separator, which would let two rows share a key", async () => {
        const {table} = stubTable()
        await expect(table.put({...event, orgId: "o#1"})).rejects.toThrow(/join part "orgId" contains "#"/)
    })

    it("treat an empty value as absent: DynamoDB can't index it", async () => {
        const {table, inputs} = stubTable({})
        await table.put({...event, note: ""})
        expect(inputs()[0].Item).not.toHaveProperty("byNote")
    })

    it("take a prefix of two or more parts only; all parts match the value", async () => {
        const {table, inputs} = stubTable({Items: []})
        await table.index.byOrg.query({orgId: "o1"}, {sk: {prefix: {orgId: "o1", kind: "k"}}})
        expect(readable(inputs()[0], inputs()[0].KeyConditionExpression)).toBe(`orgId = "o1" AND orgKind = "o1#k"`)
        typeOnly(() => {
            // @ts-expect-error a number sort key has no prefix
            void table.index.byOrgKind.query({orgId: "o1", kind: "k"}, {sk: {prefix: {at: 1}}})
        })
        await expect(table.index.byOrgKind.query({orgId: "o1", kind: "k"}, {sk: {prefix: {at: 1}} as never})).rejects.toThrow(/prefix needs a join sort key/)
    })

    it("take sort-key operands as the key's inputs", async () => {
        const {table, inputs} = stubTable({Items: []})
        await table.index.byOrgKind.query({orgId: "o1", kind: "k"}, {sk: {between: [{at: 1000}, {at: 5999}]}})
        expect(readable(inputs()[0], inputs()[0].KeyConditionExpression)).toBe(`orgKind = "o1#k" AND second BETWEEN 1 AND 5`)
    })
})

describe("a table key computed by string/number", () => {
    it("pins the key's inputs on update, as several inputs share one key", async () => {
        const {table, inputs} = stubTable({}, {})
        await table.update({userId: "u1", at: 1500}, {note: "n"})
        expect(readable(inputs()[0], inputs()[0].ConditionExpression)).toBe(`attribute_exists(userId) AND at = 1500`)
        expect(inputs()[0].Key).toEqual({userId: "u1", second: 1})
        await table.update({userId: "u1", at: 1500}, {kind: "k", orgId: "o1", note: undefined}, {upsert: true})
        expect(readable(inputs()[1], inputs()[1].ConditionExpression)).toBe(`(attribute_not_exists(userId) OR (at = 1500))`)
        expect(readable(inputs()[1], inputs()[1].UpdateExpression)).toContain(`at = 1500`)
    })
})

describe("update", () => {
    it("stores setIfMissing on a set field as a set", async () => {
        const {table, inputs} = stubTable({})
        await table.update({userId: "u1", at: 1500}, {}, {setIfMissing: {tags: ["a"]}})
        expect(readable(inputs()[0], inputs()[0].UpdateExpression)).toBe(`SET tags = if_not_exists(tags, {"set":["a"]})`)
    })

    it("refuses an upsert with current, and one that leaves a required field out", async () => {
        const {table} = stubTable()
        await expect(table.update({userId: "u1", at: 1}, {note: "x"}, {upsert: true, current: event})).rejects.toThrow(/an upsert can't take current/)
        await expect(table.update({userId: "u1", at: 1}, {note: "x"}, {upsert: true})).rejects.toThrow(/an upsert may create the row, which then needs kind, orgId/)
    })

    it("can't write the key's inputs in any operation", () => {
        const {table} = stubTable()
        typeOnly(() => {
            // @ts-expect-error part of the table key
            void table.update({userId: "u1", at: 1}, {}, {setIfMissing: {at: 2}})
            // @ts-expect-error part of the table key
            void table.update({userId: "u1", at: 1}, {}, {add: {at: 2}})
            // @ts-expect-error tags is a set: add, not append
            void table.update({userId: "u1", at: 1}, {}, {append: {tags: ["a"]}})
        })
    })
})

describe("queries", () => {
    it("refuse a filter on the queried key", async () => {
        const {table} = stubTable()
        typeOnly(() => {
            // @ts-expect-error the index's own key can't be filtered on
            void table.index.byOrg.query({orgId: "o1"}, {filter: {orgId: {eq: "o1"}}})
        })
        await expect(table.index.byOrg.query({orgId: "o1"}, {filter: {orgId: {eq: "o1"}} as never})).rejects.toThrow(/a filter can't read "orgId", a key of byOrg/)
    })

    it("need every input of a computed key", () => {
        const {table} = stubTable()
        typeOnly(() => {
            // @ts-expect-error the key's input is required
            void table.get({userId: "u1"})
        })
    })

    it("getMany asks once per key, keeps the order and passes consistentRead", async () => {
        const {table, inputs} = stubTable({Responses: {events: [{...event, userId: "u2", second: 1}, {...event, second: 1}]}})
        const rows = await table.getMany([{userId: "u1", at: 1500}, {userId: "u2", at: 1500}, {userId: "u1", at: 1999}], {consistentRead: true})
        expect(rows.map(r => r.userId)).toEqual(["u1", "u2"])
        expect(inputs()[0].RequestItems.events).toEqual({Keys: [{userId: "u1", second: 1}, {userId: "u2", second: 1}], ConsistentRead: true})
    })
})

describe("spec", () => {
    const fails = (define: () => unknown) => expect(define).toThrow()

    it("rejects a derived attribute reading a set, and sparse or optional table keys", () => {
        expect(() => GGDynamoDbTableSpec.define({name: "t", schema: IsEvent, pk: "userId", sets: ["tags"], derived: d => ({x: d.string(["tags"], r => r.tags?.[0])})}))
            .toThrow(/derived "x" reads the set "tags"/)
        expect(() => GGDynamoDbTableSpec.define({name: "t", schema: IsEvent, pk: "k", derived: d => ({k: d.flag(["note"], r => !!r.note)})}))
            .toThrow(/the table key "k" can't be sparse/)
        expect(() => GGDynamoDbTableSpec.define({name: "t", schema: IsEvent, pk: "k", derived: d => ({k: d.join("orgId", "kind").when(["note"], r => !!r.note)})}))
            .toThrow(/the table key "k" can't be sparse/)
        expect(() => GGDynamoDbTableSpec.define({name: "t", schema: IsEvent, pk: "k", derived: d => ({k: d.join("orgId", "note")})}))
            .toThrow(/the table key "k" joins the optional field "note"/)
        fails(() => GGDynamoDbTableSpec.define({name: "t", schema: IsEvent, pk: "userId", indexes: {x: {pk: "userId", sk: "kind", local: true}}}))
    })
})

describe("backfill", () => {
    it("reports rows whose keys can't be computed and keeps going", async () => {
        const {table, inputs} = stubTable({Items: [{...event, second: 1, orgId: "o#1"}, {...event, userId: "u2", second: 1}]}, {})
        const result = await table.backfillPage({concurrency: 1, segment: 1, totalSegments: 4})
        expect(result).toMatchObject({scanned: 2, rewritten: 1, failed: [{key: {userId: "u1", second: 1}, error: expect.stringMatching(/contains "#"/)}]})
        expect(inputs()[0]).toMatchObject({Segment: 1, TotalSegments: 4})
    })
})
