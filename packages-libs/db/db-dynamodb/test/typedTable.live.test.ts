import {CreateTableCommand} from "@aws-sdk/client-dynamodb"
import {GetCommand, PutCommand} from "@aws-sdk/lib-dynamodb"
import {GGTest} from "@grest-ts/testkit"
import type {} from "@grest-ts/db-dynamodb/testkit"
import {
    ENDPOINT, EventsTable, TypedTableTestConfig, TypedTableTestRuntime, WorkspacesTable, db, events, workspaces, type Workspace,
} from "./TypedTableTestRuntime"

describe("GGDynamoDbTypedTable against dynamodb-local", () => {
    GGTest.startInline(TypedTableTestRuntime)
    GGTest.with(TypedTableTestConfig.db).clone({
        host: {endpoint: ENDPOINT, region: "eu-west-1"},
        setup: async ({client}) => {
            for (const spec of [WorkspacesTable, EventsTable]) {
                await client.send(new CreateTableCommand({...spec.createTableInput(), BillingMode: "PAY_PER_REQUEST"}))
            }
        },
    })

    let n = 0
    const ws = (over: Partial<Workspace> = {}): Workspace => ({
        workspaceId: `w${++n}`, orgId: `org${n}`, userId: "u1", status: "running", createdAt: n, version: 1, ...over,
    })
    const stored = async (workspaceId: string) =>
        (await db.getDocumentClient().send(new GetCommand({TableName: "workspaces", Key: {workspaceId}}))).Item

    test("put stores the derived keys and reads strip them", async () => {
        const row = ws({pendingOp: "spawn"})
        expect(await workspaces.put(row)).toBe(true)
        expect(await stored(row.workspaceId)).toEqual({...row, orgUser: `${row.orgId}#u1`, liveOrg: row.orgId, flowPending: "1", activeUntil: Number.MAX_SAFE_INTEGER})
        expect(await workspaces.get({workspaceId: row.workspaceId})).toEqual(row)
        expect(await workspaces.put(row, {if: {workspaceId: {exists: false}}})).toBe(false)
    })

    test("queries an index by derived key parts and a sort-key range", async () => {
        const orgId = "org-q"
        const rows = [ws({orgId, status: "running"}), ws({orgId, status: "deleted"}), ws({orgId, status: "stopped"}), ws({orgId, userId: "u2"})]
        for (const r of rows) await workspaces.put(r)
        const live = await Promise.all([
            workspaces.index.byOrgUser.query({orgId, userId: "u1"}, {sk: {lt: "deleted"}}),
            workspaces.index.byOrgUser.query({orgId, userId: "u1"}, {sk: {gt: "deleted"}}),
        ])
        expect(live.flat().map(r => r.status).sort()).toEqual(["running", "stopped"])
        expect(await workspaces.index.byOrgUser.queryOne({orgId, userId: "u2"})).toEqual(rows[3])
    })

    test("a sparse index pages newest first, with the INCLUDE projection", async () => {
        const orgId = "org-page"
        const rows = [ws({orgId, name: "a"}), ws({orgId, name: "b", status: "deleted"}), ws({orgId, name: "c"}), ws({orgId, name: "d"})]
        for (const r of rows) await workspaces.put(r)
        const first = await workspaces.index.liveByOrg.queryPage({orgId}, {descending: true, limit: 2})
        expect(first.items).toEqual([rows[3], rows[2]].map(r => ({workspaceId: r.workspaceId, createdAt: r.createdAt, name: r.name, status: r.status})))
        const second = await workspaces.index.liveByOrg.queryPage({orgId}, {descending: true, limit: 2, cursor: first.cursor})
        expect(second.items.map(r => r.name)).toEqual(["a"])
    })

    test("a flag index holds just the flagged rows, keys only", async () => {
        const row = ws({pendingOp: "stop"})
        await workspaces.put(row)
        expect(await workspaces.index.pendingFlows.query()).toContainEqual({workspaceId: row.workspaceId})
        await workspaces.update({workspaceId: row.workspaceId}, {pendingOp: undefined})
        expect(await stored(row.workspaceId)).not.toHaveProperty("flowPending")
    })

    test("a computed numeric sort key", async () => {
        const orgId = "org-active"
        await workspaces.put(ws({orgId, endedAt: 100}))
        const open = ws({orgId})
        await workspaces.put(open)
        expect((await workspaces.index.byActiveUntil.query({orgId}, {sk: {gte: 500}})).map(r => r.workspaceId)).toEqual([open.workspaceId])
    })

    test("a soft delete through update drops the row from the sparse index", async () => {
        const row = ws({orgId: "org-del"})
        await workspaces.put(row)
        const updated = await workspaces.update({workspaceId: row.workspaceId}, {status: "deleted", version: 2}, {current: row, if: {version: {eq: 1}}})
        expect(updated).toEqual({...row, status: "deleted", version: 2})
        expect(await workspaces.index.liveByOrg.query({orgId: "org-del"})).toEqual([])
    })

    test("an update whose key input changed underneath it writes nothing", async () => {
        const row = ws({orgId: "org-race"})
        await workspaces.put(row)
        await workspaces.update({workspaceId: row.workspaceId}, {orgId: "org-moved"}, {current: row})
        expect(await workspaces.update({workspaceId: row.workspaceId}, {status: "deleted"}, {current: row})).toBeUndefined()
        expect(await stored(row.workspaceId)).toMatchObject({status: "running", orgId: "org-moved", liveOrg: "org-moved", orgUser: "org-moved#u1"})
    })

    test("ne holds on a row without the field unless allOf requires it", async () => {
        const row = ws()
        await workspaces.put(row)
        expect(await workspaces.update({workspaceId: row.workspaceId}, {version: 2}, {if: {allOf: [{name: {exists: true}}, {name: {ne: "x"}}]}})).toBeUndefined()
        expect(await workspaces.update({workspaceId: row.workspaceId}, {version: 2}, {if: {name: {ne: "x"}}})).toMatchObject({version: 2})
    })

    test("an upsert counter creates the row, then adds to it", async () => {
        await events.update({streamId: "counter", seq: 1}, {kind: "c"}, {upsert: true, add: {count: 2}})
        expect(await events.update({streamId: "counter", seq: 1}, {}, {upsert: true, add: {count: 3}})).toEqual({streamId: "counter", seq: 1, kind: "c", count: 5})
    })

    test("an upsert needs every derived attribute's inputs: it may create the row", async () => {
        await expect(workspaces.update({workspaceId: "w-upsert"}, {name: "x"}, {upsert: true})).rejects.toThrow(/derived "orgUser" reads "orgId"/)
    })

    test("a set field: put, atomic add and delete, read back as an array, gone once empty", async () => {
        const row = ws({tags: ["a"]})
        await workspaces.put(row)
        expect(await stored(row.workspaceId)).toMatchObject({tags: new Set(["a"])})
        expect((await workspaces.update({workspaceId: row.workspaceId}, {}, {add: {tags: ["b", "a"]}}))?.tags?.sort()).toEqual(["a", "b"])
        expect(await workspaces.update({workspaceId: row.workspaceId}, {}, {delete: {tags: ["a", "b"]}})).not.toHaveProperty("tags")
        expect(await workspaces.update({workspaceId: row.workspaceId}, {}, {add: {tags: ["c"]}, if: {tags: {exists: false}}})).toMatchObject({tags: ["c"]})
    })

    test("update on a missing row returns undefined and creates nothing", async () => {
        expect(await workspaces.update({workspaceId: "nope"}, {name: "x"})).toBeUndefined()
        expect(await stored("nope")).toBeUndefined()
    })

    test("a transaction writes all or nothing, deriving keys", async () => {
        const a = ws(), b = ws()
        await workspaces.put(b)
        expect(await db.transactWrite([workspaces.tx.put(a), workspaces.tx.update({workspaceId: b.workspaceId}, {pendingOp: "x"}, {if: {version: {eq: 9}}})])).toBe(false)
        expect(await stored(a.workspaceId)).toBeUndefined()
        expect(await db.transactWrite([workspaces.tx.put(a), workspaces.tx.update({workspaceId: b.workspaceId}, {pendingOp: "x"}, {if: {version: {eq: 1}}})])).toBe(true)
        expect(await stored(a.workspaceId)).toMatchObject({liveOrg: a.orgId})
        expect(await stored(b.workspaceId)).toMatchObject({pendingOp: "x", flowPending: "1"})
    })

    test("getMany, delete and a filtered scan", async () => {
        const a = ws({name: "keep"}), b = ws()
        await workspaces.put(a)
        await workspaces.put(b)
        expect((await workspaces.getMany([{workspaceId: a.workspaceId}, {workspaceId: b.workspaceId}, {workspaceId: "nope"}])).length).toBe(2)
        expect(await workspaces.delete({workspaceId: b.workspaceId}, {if: {version: {eq: 5}}})).toBe(false)
        expect(await workspaces.delete({workspaceId: b.workspaceId})).toBe(true)
        expect(await workspaces.scan({filter: {name: {eq: "keep"}}})).toEqual([a])
    })

    test("a composite table key: get and range query on the base table", async () => {
        for (const seq of [1, 2, 3]) await events.put({streamId: "s1", seq, kind: `k${seq}`})
        expect(await events.get({streamId: "s1", seq: 2})).toEqual({streamId: "s1", seq: 2, kind: "k2"})
        expect((await events.query({streamId: "s1"}, {sk: {between: [2, 3]}, descending: true})).map(e => e.seq)).toEqual([3, 2])
    })

    test("backfill rewrites stale and missing derived attributes, page by page", async () => {
        const raw = (item: Record<string, unknown>) => db.getDocumentClient().send(new PutCommand({TableName: "workspaces", Item: item}))
        const missing = ws({orgId: "org-bf"})
        const stale = ws({orgId: "org-bf", status: "deleted"})
        await raw(missing)
        await raw({...stale, liveOrg: "org-bf", orgUser: "wrong", activeUntil: Number.MAX_SAFE_INTEGER})

        let cursor: string | undefined
        let rewritten = 0
        do {
            const page = await workspaces.backfillPage({cursor, limit: 3})
            rewritten += page.rewritten
            expect(page.conflicts).toBe(0)
            cursor = page.cursor
        } while (cursor)

        expect(rewritten).toBe(2)
        expect(await stored(missing.workspaceId)).toMatchObject({liveOrg: "org-bf", orgUser: "org-bf#u1", activeUntil: Number.MAX_SAFE_INTEGER})
        expect(await stored(stale.workspaceId)).not.toHaveProperty("liveOrg")
        expect(await stored(stale.workspaceId)).toMatchObject({orgUser: "org-bf#u1"})
        expect((await workspaces.backfillPage({limit: 1000})).rewritten).toBe(0)
    })
})
