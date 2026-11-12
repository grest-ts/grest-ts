import {CreateTableCommand, DescribeTimeToLiveCommand, UpdateTimeToLiveCommand} from "@aws-sdk/client-dynamodb"
import {GetCommand, PutCommand} from "@aws-sdk/lib-dynamodb"
import {GGTest} from "@grest-ts/testkit"
import {GGDynamoDbCursorError} from "../src/GGDynamoDb"
import type {} from "@grest-ts/db-dynamodb/testkit"
import {
    ENDPOINT, EventsTable, TypedTableTestConfig, TypedTableTestRuntime, UsageTable, WorkspacesTable, db, events, usage, workspaces, type Workspace,
} from "./TypedTableTestRuntime"

describe("GGDynamoDbTypedTable against dynamodb-local", () => {
    GGTest.startInline(TypedTableTestRuntime)
    GGTest.with(TypedTableTestConfig.db).clone({
        host: {endpoint: ENDPOINT, region: "eu-west-1"},
        setup: async ({client}) => {
            for (const spec of [WorkspacesTable, EventsTable, UsageTable]) {
                await client.send(new CreateTableCommand({...spec.createTableInput(), BillingMode: "PAY_PER_REQUEST"}))
            }
            await client.send(new UpdateTimeToLiveCommand(UsageTable.timeToLiveInput()!))
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
        await expect(workspaces.update({workspaceId: "w-upsert"}, {name: "x"}, {upsert: true})).rejects.toThrow(/an upsert may create the row, which then needs orgId, status, createdAt, version/)
        await expect(workspaces.update({workspaceId: "w-upsert"}, {status: "running"}, {upsert: true, setIfMissing: {orgId: "o", createdAt: 1, version: 1}}))
            .rejects.toThrow(/derived "orgUser" reads "orgId", which this update changes to a value it can't know/)
    })

    test("a set field: put, atomic add and delete, read back as an array, gone once empty", async () => {
        const row = ws({tags: ["a"]})
        await workspaces.put(row)
        expect(await stored(row.workspaceId)).toMatchObject({tags: new Set(["a"])})
        expect((await workspaces.update({workspaceId: row.workspaceId}, {}, {add: {tags: ["b", "a"]}}))?.tags?.sort()).toEqual(["a", "b"])
        expect(await workspaces.update({workspaceId: row.workspaceId}, {}, {delete: {tags: ["a", "b"]}})).not.toHaveProperty("tags")
        expect(await workspaces.update({workspaceId: row.workspaceId}, {}, {add: {tags: ["c"]}, if: {tags: {exists: false}}})).toMatchObject({tags: ["c"]})
    })

    test("a table key derived from its parts: upsert counters, get and a prefix query", async () => {
        const key = (day: string) => ({userId: "u-usage", orgId: "o1", provider: "speech", day})
        await usage.update(key("2026-11-12"), {}, {upsert: true, add: {seconds: 5}, setIfMissing: {firstAt: 100}})
        await usage.update(key("2026-11-12"), {}, {upsert: true, add: {seconds: 7}, setIfMissing: {firstAt: 200}})
        await usage.update({...key("2026-11-13"), orgId: "o2"}, {status: "open"}, {upsert: true, add: {seconds: 1}})
        expect(await usage.get(key("2026-11-12"))).toEqual({...key("2026-11-12"), seconds: 12, firstAt: 100})
        expect((await usage.query({userId: "u-usage"}, {sk: {prefix: {orgId: "o1"}}})).map(r => r.day)).toEqual(["2026-11-12"])
        expect(await usage.index.byStatus.query({userId: "u-usage"}, {sk: {eq: "open"}, consistentRead: true})).toMatchObject([{orgId: "o2", seconds: 1}])
        const ttl = await db.getDocumentClient().send(new DescribeTimeToLiveCommand({TableName: UsageTable.name}))
        expect(ttl.TimeToLiveDescription?.AttributeName).toBe("purgeAt")
    })

    test("append to a list, merge into a map, and the richer conditions", async () => {
        const key = {userId: "u-ops", orgId: "o1", provider: "p", day: "d"}
        await usage.put({...key, notes: ["a"], limits: {daily: 1, monthly: 30}, seconds: 4})
        expect(await usage.update(key, {}, {append: {notes: ["b"]}, merge: {limits: {daily: 2, monthly: undefined}}}))
            .toEqual({...key, notes: ["a", "b"], limits: {daily: 2}, seconds: 4})
        const noChange = {if: {notes: {size: {gt: 5}}}} as const
        expect(await usage.update(key, {status: "x"}, noChange)).toBeUndefined()
        expect(await usage.update(key, {status: "x"}, {if: {notes: {contains: "b"}, seconds: {between: [1, 5]}, provider: {in: ["p", "q"]}}}))
            .toMatchObject({status: "x"})
    })

    test("putMany and deleteMany write past one batch, deriving keys; getMany keeps order and reads repeats once", async () => {
        const rows = Array.from({length: 30}, (_, i) => ws({orgId: "org-batch", createdAt: 10_000 + i}))
        await workspaces.putMany(rows)
        expect(await workspaces.index.liveByOrg.query({orgId: "org-batch"})).toHaveLength(30)
        const keys = [rows[2], rows[0], rows[2]].map(r => ({workspaceId: r.workspaceId}))
        expect((await workspaces.getMany([...keys, {workspaceId: "nope"}])).map(r => r.workspaceId)).toEqual([rows[2].workspaceId, rows[0].workspaceId])
        await workspaces.deleteMany(rows.map(r => ({workspaceId: r.workspaceId})))
        expect(await workspaces.index.liveByOrg.query({orgId: "org-batch"})).toEqual([])
    })

    test("a cursor from another query is a cursor error", async () => {
        for (const n of [1, 2]) await workspaces.put(ws({orgId: "org-cursor", createdAt: n}))
        const {cursor} = await workspaces.index.liveByOrg.queryPage({orgId: "org-cursor"}, {limit: 1})
        await expect(workspaces.index.byOrgUser.queryPage({orgId: "org-cursor", userId: "u1"}, {cursor})).rejects.toBeInstanceOf(GGDynamoDbCursorError)
    })

    test("merge into a map the row doesn't have is a clear error", async () => {
        const key = {userId: "u-merge", orgId: "o1", provider: "p", day: "d"}
        await usage.put(key)
        await expect(usage.update(key, {}, {merge: {limits: {daily: 1}}})).rejects.toThrow(/merge into limits, which the row doesn't have/)
    })

    test("a parallel backfill covers the table across segments", async () => {
        const raw = (item: Record<string, unknown>) => db.getDocumentClient().send(new PutCommand({TableName: "workspaces", Item: item}))
        const rows = Array.from({length: 8}, () => ws({orgId: "org-segments"}))
        for (const r of rows) await raw(r)
        let rewritten = 0
        await Promise.all([0, 1, 2].map(async segment => {
            let cursor: string | undefined
            do {
                const page = await workspaces.backfillPage({segment, totalSegments: 3, cursor, limit: 5})
                rewritten += page.rewritten
                cursor = page.cursor
            } while (cursor)
        }))
        expect(rewritten).toBeGreaterThanOrEqual(8)
        expect(await workspaces.index.liveByOrg.query({orgId: "org-segments"})).toHaveLength(8)
    })

    test("update on a missing row returns undefined and creates nothing", async () => {
        expect(await workspaces.update({workspaceId: "nope"}, {name: "x"})).toBeUndefined()
        expect(await stored("nope")).toBeUndefined()
    })

    test("a transaction writes all or nothing, deriving keys", async () => {
        const a = ws(), b = ws()
        await workspaces.put(b)
        expect(await db.transactWrite([workspaces.tx.put(a), workspaces.tx.update({workspaceId: b.workspaceId}, {pendingOp: "x"}, {if: {version: {eq: 9}}})]))
            .toEqual({ok: false, conditionFailed: [1]})
        expect(await stored(a.workspaceId)).toBeUndefined()
        expect(await db.transactWrite([workspaces.tx.put(a), workspaces.tx.update({workspaceId: b.workspaceId}, {pendingOp: "x"}, {if: {version: {eq: 1}}})])).toEqual({ok: true})
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
