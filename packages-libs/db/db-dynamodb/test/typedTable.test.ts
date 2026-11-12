import {describe, it, expect, expectTypeOf, vi} from "vitest"
import {IsLiteral, IsNumber, IsObject, IsString} from "@grest-ts/schema"
import {GGDynamoDb} from "../src/GGDynamoDb"
import {GGDynamoDbTableSpec} from "../src/GGDynamoDbTableSpec"
import {GGDynamoDbTypedTable} from "../src/GGDynamoDbTypedTable"

const IsWorkspace = IsObject({
    workspaceId: IsString,
    orgId: IsString,
    userId: IsString.orUndefined,
    projectId: IsString,
    status: IsLiteral("running", "stopped", "deleted"),
    createdAt: IsNumber,
    name: IsString.orUndefined,
    pendingOp: IsString.orUndefined,
    endedAt: IsNumber.orUndefined,
    version: IsNumber,
})
type Workspace = typeof IsWorkspace.infer

const WorkspacesTable = GGDynamoDbTableSpec.define({
    name: "workspaces",
    schema: IsWorkspace,
    pk: "workspaceId",
    derived: d => ({
        orgUser: d.join("orgId", "userId"),
        liveOrg: d.join("orgId").when(["status"], r => r.status !== "deleted"),
        flowPending: d.flag(["pendingOp"], r => !!r.pendingOp),
        activeUntil: d.number(["endedAt"], r => r.endedAt ?? Number.MAX_SAFE_INTEGER),
    }),
    indexes: {
        byOrgUser: {pk: "orgUser", sk: "status"},
        liveByOrg: {name: "live-org", pk: "liveOrg", sk: "createdAt", projection: ["name", "status"]},
        pendingFlows: {pk: "flowPending", projection: "KEYS_ONLY"},
        byActiveUntil: {pk: "orgId", sk: "activeUntil"},
    },
})

const row: Workspace = {workspaceId: "w1", orgId: "o1", userId: "u1", projectId: "p1", status: "running", createdAt: 5, version: 1}

function stubTable(...responses: (Record<string, unknown> | Error)[]) {
    const send = vi.fn(async (_command: {input: Record<string, any>}) => {
        const response = responses.shift() ?? {Items: []}
        if (response instanceof Error) throw response
        return response
    })
    const db = Object.create(GGDynamoDb.prototype) as GGDynamoDb
    Object.assign(db, {client: {send}, config: {name: "test"}})
    const inputs = () => send.mock.calls.map(c => c[0].input)
    return {table: new GGDynamoDbTypedTable(db, WorkspacesTable), inputs}
}

function typeOnly(_fn: () => void) {}

/** Resolves the placeholders, so assertions read like the expression a person would write. */
function readable(input: Record<string, any>, expression: string): string {
    return expression
        .replace(/#n\d+/g, n => input.ExpressionAttributeNames[n])
        .replace(/:v\d+/g, v => JSON.stringify(input.ExpressionAttributeValues[v]))
}

describe("GGDynamoDbTableSpec", () => {
    it("generates the CreateTable input, with default index names", () => {
        expect(WorkspacesTable.createTableInput()).toEqual({
            TableName: "workspaces",
            KeySchema: [{AttributeName: "workspaceId", KeyType: "HASH"}],
            AttributeDefinitions: [
                {AttributeName: "workspaceId", AttributeType: "S"},
                {AttributeName: "orgUser", AttributeType: "S"},
                {AttributeName: "status", AttributeType: "S"},
                {AttributeName: "liveOrg", AttributeType: "S"},
                {AttributeName: "createdAt", AttributeType: "N"},
                {AttributeName: "flowPending", AttributeType: "S"},
                {AttributeName: "orgId", AttributeType: "S"},
                {AttributeName: "activeUntil", AttributeType: "N"},
            ],
            GlobalSecondaryIndexes: [
                {IndexName: "orgUser-status-index", KeySchema: [{AttributeName: "orgUser", KeyType: "HASH"}, {AttributeName: "status", KeyType: "RANGE"}], Projection: {ProjectionType: "ALL"}},
                {IndexName: "live-org", KeySchema: [{AttributeName: "liveOrg", KeyType: "HASH"}, {AttributeName: "createdAt", KeyType: "RANGE"}], Projection: {ProjectionType: "INCLUDE", NonKeyAttributes: ["name", "status"]}},
                {IndexName: "flowPending-index", KeySchema: [{AttributeName: "flowPending", KeyType: "HASH"}], Projection: {ProjectionType: "KEYS_ONLY"}},
                {IndexName: "orgId-activeUntil-index", KeySchema: [{AttributeName: "orgId", KeyType: "HASH"}, {AttributeName: "activeUntil", KeyType: "RANGE"}], Projection: {ProjectionType: "ALL"}},
            ],
        })
    })

    it("withDerived adds the derived attributes for writers outside the table", () => {
        expect(WorkspacesTable.withDerived({...row, userId: undefined, status: "deleted"}))
            .toEqual({...row, userId: undefined, status: "deleted", activeUntil: Number.MAX_SAFE_INTEGER})
    })

    it("rejects a derived attribute that shadows a field, and keys of no storable type", () => {
        const shadowing = () => GGDynamoDbTableSpec.define({name: "t", schema: IsWorkspace, pk: "workspaceId", derived: d => ({orgId: d.join("orgId")})})
        expectTypeOf(shadowing).returns.toEqualTypeOf<`derived "orgId" is also a schema field`>()
        expect(shadowing).toThrow(/derived "orgId" is also a schema field/)
        const unknownKey = () => GGDynamoDbTableSpec.define({name: "t", schema: IsWorkspace, pk: "workspaceId", indexes: {byX: {pk: "nope"}}})
        expectTypeOf(unknownKey).returns.toEqualTypeOf<`index "byX" is keyed on an attribute that is neither a field nor derived`>()
        expect(unknownKey).toThrow(/key "nope" is neither a schema field nor derived/)
        expect(() => GGDynamoDbTableSpec.define({
            name: "t", schema: IsObject({id: IsString, tags: IsObject({a: IsString})}), pk: "id", indexes: {byTags: {pk: "tags"}},
        })).toThrow(/key "tags" must be a string or number field/)
    })
})

describe("GGDynamoDbTypedTable types", () => {
    it("types key input, sort-key conditions and projected rows", () => {
        const {table} = stubTable()
        expectTypeOf(table.index.byOrgUser.query).parameter(0).toEqualTypeOf<{orgId: string, userId: string}>()
        expectTypeOf(table.index.byOrgUser.query).returns.resolves.toEqualTypeOf<Workspace[]>()
        expectTypeOf(table.index.liveByOrg.queryPage).parameter(0).toEqualTypeOf<{orgId: string}>()
        expectTypeOf(table.index.liveByOrg.queryPage).returns.resolves.toEqualTypeOf<{
            items: {workspaceId: string, createdAt: number, name?: string | undefined, status: "running" | "stopped" | "deleted"}[]
            cursor: string | undefined
        }>()
        expectTypeOf(table.index.pendingFlows.query).returns.resolves.toEqualTypeOf<{workspaceId: string}[]>()
        expectTypeOf(table.index.byActiveUntil.query).parameter(0).toEqualTypeOf<{orgId: string}>()

        typeOnly(() => {
        // @ts-expect-error the sort key is a status, not a number
        void table.index.byOrgUser.query({orgId: "o", userId: "u"}, {sk: {lt: 3}})
        // @ts-expect-error an index without a sort key takes no sort condition
        void table.index.pendingFlows.query({}, {sk: {eq: "1"}})
        // @ts-expect-error queryPage has no filter
        void table.index.liveByOrg.queryPage({orgId: "o"}, {filter: {name: {exists: true}}})
        // @ts-expect-error derived attributes aren't writable
        void table.update({workspaceId: "w"}, {liveOrg: "o"})
        // @ts-expect-error condition values are typed by field
        void table.put(row, {if: {version: {eq: "1"}}})
        })
    })
})

describe("GGDynamoDbTypedTable writes", () => {
    it("put derives every key, omitting the absent ones", async () => {
        const {table, inputs} = stubTable({})
        await table.put({...row, status: "deleted", pendingOp: "spawn"})
        expect(inputs()[0].Item).toEqual({
            ...row, status: "deleted", pendingOp: "spawn",
            orgUser: "o1#u1", flowPending: "1", activeUntil: Number.MAX_SAFE_INTEGER,
        })
    })

    it("put rejects a row that fails the schema", async () => {
        const {table} = stubTable()
        await expect(table.put({...row, status: "nope" as "running"})).rejects.toThrow(/workspaces.put: schema validation failed for w1/)
    })

    it("conditional put compiles the typed condition", async () => {
        const {table, inputs} = stubTable({})
        await table.put(row, {if: {anyOf: [{workspaceId: {exists: false}}, {version: {eq: 0}, status: {ne: "deleted"}}]}})
        expect(readable(inputs()[0], inputs()[0].ConditionExpression))
            .toBe(`(attribute_not_exists(workspaceId) OR (version = 0 AND status <> "deleted"))`)
    })

    it("allOf ANDs conditions on one field, and its eq pins a key input", async () => {
        const {table, inputs} = stubTable({})
        await table.update({workspaceId: "w1"}, {userId: "u2"}, {if: {allOf: [{orgId: {exists: true}}, {orgId: {eq: "o1"}}, {status: {ne: "deleted"}}]}})
        expect(readable(inputs()[0], inputs()[0].UpdateExpression)).toBe(`SET userId = "u2", orgUser = "o1#u2"`)
        expect(readable(inputs()[0], inputs()[0].ConditionExpression))
            .toBe(`attribute_exists(workspaceId) AND (attribute_exists(orgId) AND orgId = "o1" AND status <> "deleted")`)
    })

    it("update leaves keys alone when no input of theirs is written", async () => {
        const {table, inputs} = stubTable({Attributes: {...row, name: "x", orgUser: "o1#u1"}})
        await expect(table.update({workspaceId: "w1"}, {name: "x"})).resolves.toEqual({...row, name: "x"})
        expect(readable(inputs()[0], inputs()[0].UpdateExpression)).toBe(`SET name = "x"`)
        expect(readable(inputs()[0], inputs()[0].ConditionExpression)).toBe("attribute_exists(workspaceId)")
    })

    it("update removes a field given as undefined, and the keys derived from it", async () => {
        const {table, inputs} = stubTable({})
        await table.update({workspaceId: "w1"}, {pendingOp: undefined})
        expect(readable(inputs()[0], inputs()[0].UpdateExpression)).toBe("REMOVE pendingOp, flowPending")
    })

    it("update refuses to derive a key from an input it can't prove", async () => {
        const {table, inputs} = stubTable()
        await expect(table.update({workspaceId: "w1"}, {status: "deleted"}))
            .rejects.toThrow(/derived "liveOrg" reads "orgId", which neither fields, an eq condition nor opts.current provides/)
        expect(inputs()).toHaveLength(0)
    })

    it("update takes a missing input from current and conditions on it", async () => {
        const {table, inputs} = stubTable({})
        await table.update({workspaceId: "w1"}, {status: "deleted"}, {current: row, if: {version: {eq: 1}}})
        expect(readable(inputs()[0], inputs()[0].UpdateExpression)).toBe(`SET status = "deleted" REMOVE liveOrg`)
        expect(readable(inputs()[0], inputs()[0].ConditionExpression)).toBe(`attribute_exists(workspaceId) AND version = 1 AND orgId = "o1"`)
    })

    it("update takes a missing input pinned by an eq condition without conditioning twice", async () => {
        const {table, inputs} = stubTable({})
        await table.update({workspaceId: "w1"}, {userId: "u2"}, {if: {orgId: {eq: "o2"}}, current: row})
        expect(readable(inputs()[0], inputs()[0].UpdateExpression)).toBe(`SET userId = "u2", orgUser = "o2#u2"`)
        expect(readable(inputs()[0], inputs()[0].ConditionExpression)).toBe(`attribute_exists(workspaceId) AND orgId = "o2"`)
    })

    it("update conditions an undefined input of current on its absence", async () => {
        const {table, inputs} = stubTable({})
        await table.update({workspaceId: "w1"}, {orgId: "o2"}, {current: {...row, userId: undefined, status: "running"}})
        expect(readable(inputs()[0], inputs()[0].UpdateExpression)).toBe(`SET orgId = "o2", liveOrg = "o2" REMOVE orgUser`)
        expect(readable(inputs()[0], inputs()[0].ConditionExpression))
            .toBe(`attribute_exists(workspaceId) AND attribute_not_exists(userId) AND status = "running"`)
    })

    it("update validates the written fields and refuses the table key", async () => {
        const {table} = stubTable()
        await expect(table.update({workspaceId: "w1"}, {createdAt: "x" as unknown as number})).rejects.toThrow(/schema validation failed/)
        await expect(table.update({workspaceId: "w1"}, {version: undefined as unknown as number})).rejects.toThrow(/schema validation failed/)
        await expect(table.update({workspaceId: "w1"}, {workspaceId: "w2"} as object)).rejects.toThrow(/"workspaceId" is part of the table key/)
        await expect(table.update({workspaceId: "w1"}, {nope: 1} as object)).rejects.toThrow(/"nope" is not a schema field/)
    })

    it("tx builds the same writes", () => {
        const {table} = stubTable()
        const put = table.tx.put(row, {if: {workspaceId: {exists: false}}})
        expect(put.Put!.Item).toMatchObject({orgUser: "o1#u1", liveOrg: "o1"})
        const update = table.tx.update({workspaceId: "w1"}, {pendingOp: "stop"})
        expect(readable(update.Update!, update.Update!.UpdateExpression!)).toBe(`SET pendingOp = "stop", flowPending = "1"`)
        expect(() => table.tx.update({workspaceId: "w1"}, {userId: "u2"})).toThrow(/derived "orgUser" reads "orgId"/)
    })
})

describe("GGDynamoDbTypedTable backfill", () => {
    it("rewrites only differing derived attributes, conditioned on the inputs it read, and counts conflicts", async () => {
        const conflict = Object.assign(new Error("condition"), {name: "ConditionalCheckFailedException"})
        const current = {...row, orgUser: "o1#u1", liveOrg: "o1", activeUntil: Number.MAX_SAFE_INTEGER}
        const {table, inputs} = stubTable(
            {Items: [current, {...row, workspaceId: "w2", orgUser: "stale"}, {...row, workspaceId: "w3"}], LastEvaluatedKey: {workspaceId: "w3"}},
            {},
            conflict,
        )
        await expect(table.backfillPage({limit: 3})).resolves.toEqual({scanned: 3, rewritten: 1, conflicts: 1, cursor: expect.any(String)})
        expect(inputs()[0]).toMatchObject({Limit: 3})
        expect(inputs()).toHaveLength(3)
        expect(inputs()[1].Key).toEqual({workspaceId: "w2"})
        expect(readable(inputs()[1], inputs()[1].UpdateExpression)).toBe(`SET orgUser = "o1#u1", liveOrg = "o1", activeUntil = ${Number.MAX_SAFE_INTEGER}`)
        expect(readable(inputs()[1], inputs()[1].ConditionExpression))
            .toBe(`attribute_exists(workspaceId) AND orgId = "o1" AND userId = "u1" AND status = "running" AND attribute_not_exists(endedAt)`)
    })
})

describe("GGDynamoDbTypedTable reads", () => {
    it("queries by derived key parts and a sort-key condition, stripping derived attributes", async () => {
        const {table, inputs} = stubTable({Items: [{...row, orgUser: "o1#u1", liveOrg: "o1"}]})
        await expect(table.index.byOrgUser.query({orgId: "o1", userId: "u1"}, {sk: {lt: "deleted"}, filter: {name: {exists: true}}}))
            .resolves.toEqual([row])
        expect(inputs()[0]).toMatchObject({IndexName: "orgUser-status-index"})
        expect(readable(inputs()[0], inputs()[0].KeyConditionExpression)).toBe(`orgUser = "o1#u1" AND status < "deleted"`)
        expect(readable(inputs()[0], inputs()[0].FilterExpression)).toBe("attribute_exists(name)")
    })

    it("queries a flag index with no key input, and pages", async () => {
        const {table, inputs} = stubTable({Items: [{workspaceId: "w1", flowPending: "1"}], LastEvaluatedKey: {workspaceId: "w1"}})
        const page = await table.index.pendingFlows.queryPage(undefined, {limit: 1})
        expect(page.items).toEqual([{workspaceId: "w1"}])
        expect(page.cursor).toBeTypeOf("string")
        expect(readable(inputs()[0], inputs()[0].KeyConditionExpression)).toBe(`flowPending = "1"`)
        expect(inputs()[0]).toMatchObject({IndexName: "flowPending-index", Limit: 1})
    })

    it("supports between and beginsWith, descending", async () => {
        const {table, inputs} = stubTable({Items: []}, {Items: []})
        await table.index.liveByOrg.query({orgId: "o1"}, {sk: {between: [1, 9]}, descending: true})
        await table.index.byOrgUser.queryOne({orgId: "o1", userId: "u1"}, {sk: {beginsWith: "run"}})
        expect(readable(inputs()[0], inputs()[0].KeyConditionExpression)).toBe(`liveOrg = "o1" AND createdAt BETWEEN 1 AND 9`)
        expect(inputs()[0]).toMatchObject({ScanIndexForward: false})
        expect(readable(inputs()[1], inputs()[1].KeyConditionExpression)).toBe(`orgUser = "o1#u1" AND begins_with(status, "run")`)
        expect(inputs()[1]).toMatchObject({Limit: 1})
    })

    it("refuses a query without the key parts", async () => {
        const {table} = stubTable()
        await expect(table.index.byOrgUser.query({orgId: "o1"} as {orgId: string, userId: string})).rejects.toThrow(/needs orgId, userId/)
    })
})
