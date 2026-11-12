import {describe, it, expect, expectTypeOf} from "vitest"
import {IsDiscriminated, IsLiteral, IsNumber, IsObject, IsString, IsUnion} from "@grest-ts/schema"
import {GGDynamoDbTableSpec} from "../src/GGDynamoDbTableSpec"
import {GGDynamoDbDevTables} from "../src/GGDynamoDbDevTables"
import {readable, stubDb, typeOnly} from "./typedTableTestUtils"
import {GGDynamoDbTypedTable} from "../src/GGDynamoDbTypedTable"

const IsQueued = IsObject({buildId: IsString, status: IsLiteral("queued"), queuedAt: IsNumber})
const IsRunning = IsObject({buildId: IsString, status: IsLiteral("running"), runner: IsString, lease: IsObject({owner: IsString, until: IsNumber})})
const IsBuild = IsDiscriminated("status", {queued: IsQueued, running: IsRunning})
type Build = typeof IsBuild.infer

const BuildsTable = GGDynamoDbTableSpec.define({
    name: "builds",
    schema: IsBuild,
    pk: "buildId",
    derived: d => ({
        runnerKey: d.join("runner"),
        pending: d.flag(["status"], r => r.status === "queued", {value: "queued"}).readable(),
    }),
    indexes: {byRunner: {pk: "runnerKey"}, pending: {pk: "pending", sk: "buildId"}},
})

const queued: Build = {buildId: "b1", status: "queued", queuedAt: 1}
const running: Build = {buildId: "b2", status: "running", runner: "r1", lease: {owner: "r1", until: 9}}

describe("a union row schema", () => {
    it("reads back the union; keys, indexes and conditions see its fields one by one", async () => {
        const {db} = stubDb({Item: {...running, runnerKey: "r1"}}, {Items: [{...running, runnerKey: "r1"}]})
        const builds = new GGDynamoDbTypedTable(db, BuildsTable)
        const row = await builds.get("b2")
        expectTypeOf(row!).toMatchTypeOf<Build>()
        expectTypeOf(row!.pending).toEqualTypeOf<"queued" | undefined>()
        if (row?.status === "running") expectTypeOf(row.lease).toEqualTypeOf<{owner: string, until: number}>()
        expect(row).toEqual(running)
        await expect(builds.index.byRunner.query({runner: "r1"})).resolves.toEqual([running])
        expectTypeOf(builds.index.byRunner.query).parameter(0).toEqualTypeOf<{runner: string}>()
    })

    it("validates a put against its variant, and an update field by field", async () => {
        const {db, inputs} = stubDb({}, {Attributes: running})
        const builds = new GGDynamoDbTypedTable(db, BuildsTable)
        await builds.put(running)
        expect(inputs()[0].Item).toEqual({...running, runnerKey: "r1"})
        await expect(builds.put({buildId: "b3", status: "running", queuedAt: 1} as never)).rejects.toThrow(/builds.put: schema validation failed/)
        await builds.update("b2", {runner: "r2"})
        expect(readable(inputs()[1], inputs()[1].UpdateExpression)).toBe(`SET runner = "r2", runnerKey = "r2"`)
        await expect(builds.update("b2", {runner: 5 as never})).rejects.toThrow(/schema validation failed for "runner"/)
        await expect(builds.update("b2", {status: "done" as never})).rejects.toThrow(/schema validation failed for "status"/)
    })

    it("stores a sparse index only for the variants that have its field", async () => {
        const {db, inputs} = stubDb({})
        await new GGDynamoDbTypedTable(db, BuildsTable).put(queued)
        expect(inputs()[0].Item).toEqual({...queued, pending: "queued"})
    })

    it("supplies the discriminator to a variant that doesn't declare it", async () => {
        const IsTagged = IsDiscriminated("kind", {a: IsObject({id: IsString, x: IsString}), b: IsObject({id: IsString, kind: IsLiteral("b"), y: IsNumber})})
        const Spec = GGDynamoDbTableSpec.define({name: "t", schema: IsTagged, pk: "id", indexes: {byKind: {pk: "kind", sk: "id"}}})
        expect(Spec.createTableInput().AttributeDefinitions).toContainEqual({AttributeName: "kind", AttributeType: "S"})
        expect(Spec.requiredFields).toEqual(["id", "kind"])
    })

    it("takes an IsUnion of objects; a field typed differently in two variants takes either", async () => {
        const IsEvent = IsUnion(IsObject({id: IsString, at: IsNumber}), IsObject({id: IsString, at: IsString, note: IsString}))
        const Events = GGDynamoDbTableSpec.define({name: "events", schema: IsEvent, pk: "id"})
        const {db, inputs} = stubDb({}, {})
        const events = new GGDynamoDbTypedTable(db, Events)
        await events.update("e1", {at: "noon"})
        await events.update("e1", {at: 5})
        expect(inputs()).toHaveLength(2)
        await expect(events.update("e1", {at: true as never})).rejects.toThrow(/schema validation failed for "at"/)
        expect(() => GGDynamoDbTableSpec.define({name: "t", schema: IsString as never, pk: "id"})).toThrow(/must be an object or a union of objects, not string/)
    })
})

describe("union field merging", () => {
    it("keeps a field optional when any variant declares it so, and reads into a union nested in a variant", () => {
        const IsA = IsObject({id: IsString, kind: IsLiteral("a"), note: IsString.orUndefined})
        const IsB = IsObject({id: IsString, kind: IsLiteral("b"), note: IsString.nonEmpty})
        const Notes = GGDynamoDbTableSpec.define({name: "t", schema: IsUnion(IsA, IsB), pk: "id"})
        expect(Notes.requiredFields).toEqual(["id", "kind"])
        const Nested = GGDynamoDbTableSpec.define({
            name: "t", pk: "id",
            schema: IsDiscriminated("kind", {a: IsUnion(IsObject({id: IsString, x: IsString}), IsObject({id: IsString, y: IsNumber})), b: IsObject({id: IsString})}),
            indexes: {byY: {pk: "y"}},
        })
        expect(Nested.createTableInput().AttributeDefinitions).toContainEqual({AttributeName: "y", AttributeType: "N"})
    })
})

describe("readable derived attributes", () => {
    it("stay readable through when and separator", () => {
        const Spec = GGDynamoDbTableSpec.define({
            name: "t", schema: IsQueued, pk: "buildId",
            derived: d => ({k: d.join("buildId", "status").readable().separator(":").when(["queuedAt"], r => r.queuedAt > 0)}),
        })
        expect(Spec.toRow({...queued, k: "b1:queued"})).toEqual({...queued, k: "b1:queued"})
    })

    it("come back on reads, typed with their value", async () => {
        const {db} = stubDb({Item: {...queued, pending: "queued"}})
        await expect(new GGDynamoDbTypedTable(db, BuildsTable).get("b1")).resolves.toEqual({...queued, pending: "queued"})
    })
})

describe("derived options", () => {
    const IsDoc = IsObject({docId: IsString, path: IsString, owner: IsObject({org: IsString, user: IsString}), title: IsString.orUndefined})
    const DocsTable = GGDynamoDbTableSpec.define({
        name: "docs",
        schema: IsDoc,
        pk: "ownerKey",
        sk: "docPath",
        derived: d => ({
            ownerKey: d.string(["owner"], r => `${r.owner.org}/${r.owner.user}`),
            docPath: d.join("docId", "path").separator(":"),
        }),
    })
    const doc = {docId: "d1", path: "a:b", owner: {org: "o", user: "u"}}

    it("join takes another separator, and the separator inside its last part", async () => {
        const {db, inputs} = stubDb({}, {Items: []})
        const docs = new GGDynamoDbTypedTable(db, DocsTable)
        await docs.put(doc)
        expect(inputs()[0].Item).toMatchObject({docPath: "d1:a:b", ownerKey: "o/u"})
        await docs.query({owner: doc.owner}, {sk: {prefix: {docId: "d1"}}})
        expect(readable(inputs()[1], inputs()[1].KeyConditionExpression)).toBe(`ownerKey = "o/u" AND begins_with(docPath, "d1:")`)
        await expect(docs.put({...doc, docId: "d:1"})).rejects.toThrow(/join part "docId" contains ":"/)
        await expect(docs.query({owner: doc.owner}, {sk: {prefix: {docId: "d:1"}}})).rejects.toThrow(/join part "docId" contains ":"/)
    })

    it("an object key input is compared by value", async () => {
        const stored = {...doc, ownerKey: "o/u", docPath: "d1:a:b"}
        const {db} = stubDb({Item: stored}, {Item: stored})
        const docs = new GGDynamoDbTypedTable(db, DocsTable)
        await expect(docs.get({owner: {user: "u", org: "o"}, docId: "d1", path: "a:b"})).resolves.toEqual(doc)
        await expect(docs.get({owner: {org: "o", user: "u", extra: 1} as never, docId: "d1", path: "a:b"})).resolves.toBeUndefined()
    })

    it("skipUndefined leaves fields given as undefined", async () => {
        const {db, inputs} = stubDb({}, {})
        const docs = new GGDynamoDbTypedTable(db, DocsTable)
        const key = {owner: doc.owner, docId: "d1", path: "p"}
        await expect(docs.update(key, {title: undefined}, {skipUndefined: true})).rejects.toThrow(/nothing to write/)
        await docs.update(key, {title: undefined})
        expect(readable(inputs()[0], inputs()[0].UpdateExpression)).toBe(`REMOVE title`)
    })
})

describe("nested-path conditions", () => {
    it("compile to a document path, typed one level into a map field", async () => {
        const {db, inputs} = stubDb({})
        const builds = new GGDynamoDbTypedTable(db, BuildsTable)
        await builds.update("b2", {runner: "r2"}, {if: {"lease.owner": {eq: "r1"}, "lease.until": {lt: 10}}})
        expect(readable(inputs()[0], inputs()[0].ConditionExpression)).toBe(`attribute_exists(buildId) AND (lease.owner = "r1" AND lease.until < 10)`)
        typeOnly(() => {
            // @ts-expect-error owner is a string
            void builds.delete("b2", {if: {"lease.owner": {lt: 1}}})
            // @ts-expect-error no such key in lease
            void builds.delete("b2", {if: {"lease.nope": {exists: true}}})
        })
    })

    it("don't prove a derived key's input", async () => {
        const {db} = stubDb()
        const builds = new GGDynamoDbTypedTable(db, BuildsTable)
        expect(() => builds.tx.update("b2", {status: "running"}, {if: {"lease.owner": {eq: "r1"}}})).not.toThrow()
    })
})

describe("per-instance table names", () => {
    it("of(spec) takes the table's name, and the spec keeps its own", async () => {
        class Builds extends GGDynamoDbTypedTable.of(BuildsTable) {}
        const {db, inputs} = stubDb({})
        const builds = new Builds(db, {name: "builds-test-7"})
        await builds.get("b1")
        expect(inputs()[0].TableName).toBe("builds-test-7")
        expect(builds.spec.createTableInput().TableName).toBe("builds-test-7")
        expect(BuildsTable.name).toBe("builds")
        expect(builds.spec.indexes.pending.indexName).toBe("pending-buildId-index")
    })
})

describe("specs sharing a table", () => {
    const IsItem = IsObject({scope: IsString, kind: IsString, itemId: IsString, orgId: IsString})
    const IsPointer = IsObject({itemId: IsString, scope: IsString})
    const Items = GGDynamoDbTableSpec.define({
        name: "items", schema: IsItem, pk: "scopeKey", sk: "itemKey",
        derived: d => ({scopeKey: d.join("scope"), itemKey: d.join("kind", "itemId")}),
        indexes: {byOrg: {pk: "orgId"}},
    })
    const Pointers = GGDynamoDbTableSpec.define({
        name: "items", schema: IsPointer, pk: "scopeKey", sk: "itemKey",
        derived: d => ({scopeKey: d.string(["itemId"], r => `id#${r.itemId}`), itemKey: d.join("scope")}),
    })
    const noClient = {send: () => { throw new Error("no client") }} as never

    it("ensure refuses specs that disagree on the table", async () => {
        const OtherKey = GGDynamoDbTableSpec.define({name: "items", schema: IsPointer, pk: "scope"})
        await expect(GGDynamoDbDevTables.ensure(noClient, [Items, OtherKey])).rejects.toThrow(/the specs for "items" have different keys/)
        const OtherIndex = GGDynamoDbTableSpec.define({...{name: "items", schema: IsItem, pk: "scopeKey", sk: "itemKey"}, derived: d => ({scopeKey: d.join("scope"), itemKey: d.join("kind", "itemId")}), indexes: {byOrg: {pk: "orgId", projection: "KEYS_ONLY"}}})
        await expect(GGDynamoDbDevTables.ensure(noClient, [Items, OtherIndex])).rejects.toThrow(/declare index orgId-index differently/)
        const Reordered = GGDynamoDbTableSpec.define({name: "items", schema: IsItem, pk: "scopeKey", sk: "itemKey", derived: d => ({scopeKey: d.join("scope"), itemKey: d.join("kind", "itemId")}), indexes: {byOrg: {pk: "orgId", projection: ["kind", "scope"]}}})
        const Listed = GGDynamoDbTableSpec.define({name: "items", schema: IsItem, pk: "scopeKey", sk: "itemKey", derived: d => ({scopeKey: d.join("scope"), itemKey: d.join("kind", "itemId")}), indexes: {byOrg: {pk: "orgId", projection: ["scope", "kind"]}}})
        await expect(GGDynamoDbDevTables.ensure(noClient, [Reordered, Listed])).rejects.toThrow(/no client/)
        await expect(GGDynamoDbDevTables.ensure(noClient, [Items, Pointers])).rejects.toThrow(/no client/)
    })

    it("backfill leaves the rows of a spec keyed on the same plain fields that lack its required ones", async () => {
        const IsNote = IsObject({pk: IsString, sk: IsString, text: IsString})
        const IsMark = IsObject({pk: IsString, sk: IsString, at: IsNumber})
        const Notes = GGDynamoDbTableSpec.define({name: "shared", schema: IsNote, pk: "pk", sk: "sk", derived: d => ({len: d.number(["text"], r => r.text.length)}), indexes: {byLen: {pk: "len"}}})
        const {db, inputs} = stubDb({Items: [{pk: "p", sk: "m", at: 1}]})
        GGDynamoDbTableSpec.define({name: "shared", schema: IsMark, pk: "pk", sk: "sk"})
        await expect(new GGDynamoDbTypedTable(db, Notes).backfillPage()).resolves.toMatchObject({scanned: 1, skipped: 1, rewritten: 0})
        expect(inputs()).toHaveLength(1)
    })

    it("backfill leaves the other spec's rows", async () => {
        const {db} = stubDb({Items: [{scope: "s", itemId: "i", scopeKey: "id#i", itemKey: "s"}, {scope: "s", kind: "k", itemId: "i", orgId: "o", scopeKey: "s", itemKey: "k#i"}]})
        await expect(new GGDynamoDbTypedTable(db, Items).backfillPage()).resolves.toMatchObject({scanned: 2, skipped: 1, rewritten: 0})
    })
})
