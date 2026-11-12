import {describe, it, expect, expectTypeOf} from "vitest"
import {IsNumber, IsObject, IsString} from "@grest-ts/schema"
import {GGDynamoDbTableSpec} from "../src/GGDynamoDbTableSpec"
import {readable, stubDb, typeOnly} from "./typedTableTestUtils"
import {GGDynamoDbTypedTable} from "../src/GGDynamoDbTypedTable"

const IsProject = IsObject({projectId: IsString, orgId: IsString, name: IsString, version: IsNumber.orUndefined})
type Project = typeof IsProject.infer

const ProjectsTable = GGDynamoDbTableSpec.define({
    name: "projects",
    schema: IsProject,
    pk: "projectId",
    version: "version",
    indexes: {byOrg: {pk: "orgId"}},
})

class ProjectStore extends GGDynamoDbTypedTable.of(ProjectsTable) {
    listByOrg(orgId: string) {
        return this.index.byOrg.query({orgId})
    }
}

const IsEntry = IsObject({streamId: IsString, seq: IsNumber, note: IsString})
const EntriesTable = GGDynamoDbTableSpec.define({name: "entries", schema: IsEntry, pk: "streamId", sk: "seq"})

const project: Project = {projectId: "p1", orgId: "o1", name: "n"}

describe("a store extending GGDynamoDbTypedTable.of(spec)", () => {
    it("inherits the table's methods and takes a bare key on a one-field key", async () => {
        const {db, inputs} = stubDb({Item: {...project, extra: 1}}, {Items: [project]})
        const store = new ProjectStore(db)
        expectTypeOf(store.get).parameter(0).toEqualTypeOf<{projectId: string} | string>()
        await expect(store.get("p1")).resolves.toEqual(project)
        await expect(store.listByOrg("o1")).resolves.toEqual([project])
        expect(inputs()[0].Key).toEqual({projectId: "p1"})
    })

    it("needs the key object on a table with a sort key", async () => {
        const {db} = stubDb()
        const entries = new GGDynamoDbTypedTable(db, EntriesTable)
        typeOnly(() => {
            // @ts-expect-error a sort key table is addressed by its key object
            void entries.get("s1")
        })
        await expect(entries.get("s1" as never)).rejects.toThrow(/the key needs streamId, seq/)
    })
})

describe("create, save, take and expectVersion", () => {
    it("create conditions on the key being new", async () => {
        const {db, inputs} = stubDb({})
        await new ProjectStore(db).create(project)
        expect(readable(inputs()[0], inputs()[0].ConditionExpression)).toBe("attribute_not_exists(projectId)")
    })

    it("save writes the next version, conditioned on the one read; a row without one counts as 0", async () => {
        const {db, inputs} = stubDb({}, {})
        const store = new ProjectStore(db)
        await expect(store.save(project)).resolves.toEqual({...project, version: 1})
        await expect(store.save({...project, version: 4})).resolves.toEqual({...project, version: 5})
        expect(readable(inputs()[0], inputs()[0].ConditionExpression)).toBe("(attribute_not_exists(version) OR version = 0)")
        expect(inputs()[0].Item).toMatchObject({version: 1})
        expect(readable(inputs()[1], inputs()[1].ConditionExpression)).toBe("version = 4")
        expect(inputs()[1].Item).toMatchObject({version: 5})
    })

    it("every write bumps the version, and nothing writes it directly", async () => {
        const {db, inputs} = stubDb({}, {}, {})
        const store = new ProjectStore(db)
        await store.put({...project, version: 7})
        await store.create(project)
        await store.update("p1", {name: "m"})
        expect(inputs()[0].Item).toMatchObject({version: 8})
        expect(inputs()[1].Item).toMatchObject({version: 1})
        expect(readable(inputs()[2], inputs()[2].UpdateExpression)).toBe(`SET name = "m" ADD version 1`)
        await expect(store.update("p1", {version: 2})).rejects.toThrow(/"version" is the version; every write bumps it/)
        await expect(store.update("p1", {}, {setIfMissing: {version: 1}})).rejects.toThrow(/setIfMissing "version": it is the version/)
        expect(() => GGDynamoDbTableSpec.define({name: "t", schema: IsProject, pk: "projectId", version: "version", derived: d => ({v: d.number(["version"], r => r.version)})}))
            .toThrow(/derived "v" reads the version "version"/)
    })

    it("save and expectVersion need a spec version", async () => {
        const {db} = stubDb()
        const entries = new GGDynamoDbTypedTable(db, EntriesTable)
        await expect(entries.save({streamId: "s", seq: 1, note: "n"})).rejects.toThrow(/entries.save: the spec has no version field/)
        await expect(entries.update({streamId: "s", seq: 1}, {note: "x"}, {expectVersion: 1})).rejects.toThrow(/the spec has no version field/)
    })

    it("update with expectVersion conditions on it", async () => {
        const {db, inputs} = stubDb({})
        await new ProjectStore(db).update("p1", {name: "m"}, {expectVersion: 2})
        expect(readable(inputs()[0], inputs()[0].UpdateExpression)).toBe(`SET name = "m" ADD version 1`)
        expect(readable(inputs()[0], inputs()[0].ConditionExpression)).toBe("attribute_exists(projectId) AND version = 2")
    })

    it("take deletes and returns the old row in the schema's shape", async () => {
        const {db, inputs} = stubDb({Attributes: {...project, retired: true}})
        await expect(new ProjectStore(db).take("p1")).resolves.toEqual(project)
        expect(inputs()[0]).toMatchObject({Key: {projectId: "p1"}, ReturnValues: "ALL_OLD"})
    })

    it("tx.create carries the same condition", () => {
        const {db} = stubDb()
        const item = new ProjectStore(db).tx.create(project)
        expect(readable(item.Put!, item.Put!.ConditionExpression!)).toBe("attribute_not_exists(projectId)")
        expect(item.Put!.Item).toMatchObject({version: 1})
    })
})

describe("spec", () => {
    it("takes a derived number attribute as the TTL, and refuses a version that isn't a number field", () => {
        const Spec = GGDynamoDbTableSpec.define({
            name: "t", schema: IsProject, pk: "projectId", ttl: "purgeAt",
            derived: d => ({purgeAt: d.number(["name"], r => r.name.length)}),
        })
        expect(Spec.timeToLiveInput()).toEqual({TableName: "t", TimeToLiveSpecification: {AttributeName: "purgeAt", Enabled: true}})
        // @ts-expect-error version is a number field
        expect(() => GGDynamoDbTableSpec.define({name: "t", schema: IsProject, pk: "projectId", version: "name"})).toThrow(/version "name" is not a number field/)
    })

    it("toRow keeps the schema's fields only", () => {
        expect(ProjectsTable.toRow({...project, gone: 1})).toEqual(project)
    })
})
