import {describe, it, expect, vi} from "vitest"
import {GGDynamoDb} from "../src/GGDynamoDb"
import {GGDynamoDbTable} from "../src/GGDynamoDbTable"
import {IsObject, IsString} from "@grest-ts/schema"

type Response = {Item?: unknown, Items?: unknown[], LastEvaluatedKey?: Record<string, unknown>}

/** A GGDynamoDb whose SDK client is a stub: records each command's input and
 *  answers with the queued responses (an empty final page once they run out). */
function stubDb(...responses: Response[]) {
    const send = vi.fn(async (_command: {input: Record<string, unknown>}) => responses.shift() ?? {Items: []})
    const db = Object.create(GGDynamoDb.prototype) as GGDynamoDb
    Object.assign(db, {client: {send}, config: {name: "test"}})
    const inputs = () => send.mock.calls.map(c => c[0].input)
    return {db, send, inputs}
}

const IsRow = IsObject({id: IsString, status: IsString})
type Row = typeof IsRow.infer

describe("get", () => {
    it("is strongly consistent by default", async () => {
        const {db, inputs} = stubDb({Item: {id: "a"}})
        await expect(db.get("t", {id: "a"})).resolves.toEqual({id: "a"})
        expect(inputs()[0]).toEqual({TableName: "t", Key: {id: "a"}, ConsistentRead: true})
    })

    it("can opt out of a consistent read", async () => {
        const {db, inputs} = stubDb({})
        await db.get("t", {id: "a"}, {consistentRead: false})
        expect(inputs()[0]).toMatchObject({ConsistentRead: false})
    })

    it("passes the option through the table wrapper", async () => {
        const {db, inputs} = stubDb({}, {})
        const table = new GGDynamoDbTable<Row, "id">(db, "rows", IsRow, "id")
        await table.get("a")
        await table.get("a", undefined, {consistentRead: false})
        expect(inputs().map(i => i.ConsistentRead)).toEqual([true, false])
    })
})

describe("queryPage", () => {
    it("sends names, filter and consistentRead", async () => {
        const {db, inputs} = stubDb({Items: [{id: "a"}]})
        await db.queryPage("t", undefined, "id = :id AND #s < :s", {":id": "a", ":s": "z", ":p": 1}, {
            names: {"#s": "status"}, filter: "priority > :p", consistentRead: true, limit: 5,
        })
        expect(inputs()[0]).toEqual({
            TableName: "t",
            IndexName: undefined,
            KeyConditionExpression: "id = :id AND #s < :s",
            ExpressionAttributeValues: {":id": "a", ":s": "z", ":p": 1},
            ExpressionAttributeNames: {"#s": "status"},
            FilterExpression: "priority > :p",
            ConsistentRead: true,
            Limit: 5,
        })
    })

    it("leaves the new inputs off when not asked for", async () => {
        const {db, inputs} = stubDb({Items: []})
        await db.queryPage("t", "idx", "id = :id", {":id": "a"}, {names: {}})
        expect(inputs()[0]).not.toHaveProperty("ExpressionAttributeNames")
        expect(inputs()[0]).not.toHaveProperty("FilterExpression")
        expect(inputs()[0]).not.toHaveProperty("ConsistentRead")
    })
})

describe("query", () => {
    it("passes each request only the rows still wanted", async () => {
        const {db, inputs} = stubDb(
            {Items: [1, 2, 3], LastEvaluatedKey: {id: "3"}},
            {Items: [4, 5, 6], LastEvaluatedKey: {id: "6"}},
        )
        await expect(db.query("t", undefined, "id = :id", {":id": "a"}, {limit: 5})).resolves.toEqual([1, 2, 3, 4, 5])
        expect(inputs().map(i => i.Limit)).toEqual([5, 2])
    })

    it("with a filter, sends no Limit and keeps reading until `limit` matches", async () => {
        // Limit counts rows read before the filter; on the wire it would make a
        // sparse filter return short or empty pages for as many round trips.
        const {db, inputs} = stubDb(
            {Items: [], LastEvaluatedKey: {id: "1"}},
            {Items: [1], LastEvaluatedKey: {id: "2"}},
            {Items: [2, 3], LastEvaluatedKey: {id: "3"}},
        )
        await expect(db.query("t", undefined, "id = :id", {":id": "a"}, {limit: 2, filter: "x = :id"})).resolves.toEqual([1, 2])
        expect(inputs()).toHaveLength(3)
        expect(inputs().map(i => i.Limit)).toEqual([undefined, undefined, undefined])
        expect(inputs().every(i => i.FilterExpression === "x = :id")).toBe(true)
    })

    it("caps a filtered query on returned rows, not rows read", async () => {
        const {db} = stubDb(
            {Items: [], LastEvaluatedKey: {id: "1"}},
            {Items: Array(6_000).fill(0), LastEvaluatedKey: {id: "2"}},
            {Items: Array(6_000).fill(0), LastEvaluatedKey: {id: "3"}},
        )
        await expect(db.query("t", undefined, "id = :id", {":id": "a"}, {filter: "x = :id"})).rejects.toThrow(/exceeded 10000 rows/)
    })

    it("queryOne keeps filter and names, and drops the wire limit with a filter", async () => {
        const {db, inputs} = stubDb({Items: [{id: "a", status: "x"}]}, {Items: [{id: "a", status: "x"}]})
        const table = new GGDynamoDbTable<Row, "id">(db, "rows", IsRow, "id")
        await table.queryOne("idx", "id = :id", {":id": "a"})
        await expect(table.queryOne("idx", "id = :id", {":id": "a", ":s": "x"}, {filter: "#s = :s", names: {"#s": "status"}}))
            .resolves.toEqual({id: "a", status: "x"})
        expect(inputs()[0]).toMatchObject({Limit: 1})
        expect(inputs()[1]).toMatchObject({Limit: undefined, FilterExpression: "#s = :s", ExpressionAttributeNames: {"#s": "status"}})
    })
})

describe("scan", () => {
    it("sends filter, values, names and consistentRead", async () => {
        const {db, inputs} = stubDb({Items: [{id: "a"}]})
        const table = new GGDynamoDbTable<Row, "id">(db, "rows", IsRow, "id")
        await table.scan({filter: "#s = :s", names: {"#s": "status"}, values: {":s": "x"}, consistentRead: true})
        expect(inputs()[0]).toEqual({
            TableName: "rows",
            Limit: undefined,
            FilterExpression: "#s = :s",
            ExpressionAttributeNames: {"#s": "status"},
            ExpressionAttributeValues: {":s": "x"},
            ConsistentRead: true,
        })
    })

    it("omits an empty values map, which DynamoDB rejects", async () => {
        const {db, inputs} = stubDb({Items: []})
        await db.scanPage("t", {values: {}})
        expect(inputs()[0]).toEqual({TableName: "t", Limit: undefined})
    })
})
