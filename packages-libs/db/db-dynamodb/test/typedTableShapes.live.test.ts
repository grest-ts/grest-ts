import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {IsDiscriminated, IsLiteral, IsNumber, IsObject, IsString} from "@grest-ts/schema"
import {GGDynamoDb} from "../src/GGDynamoDb"
import {GGDynamoDbDevTables} from "../src/GGDynamoDbDevTables"
import {GGDynamoDbTableSpec} from "../src/GGDynamoDbTableSpec"
import {GGDynamoDbTypedTable} from "../src/GGDynamoDbTypedTable"
import {ENDPOINT} from "./TypedTableTestRuntime"

const IsGrant = IsObject({orgId: IsString, principal: IsObject({kind: IsString, id: IsString}), role: IsString})
const GrantsTable = GGDynamoDbTableSpec.define({
    name: "grants",
    schema: IsGrant,
    pk: "grantKey",
    derived: d => ({grantKey: d.string(["orgId", "principal"], r => `${r.orgId}/${r.principal.kind === "team" ? "t" : "u"}`)}),
})

const IsQueued = IsObject({jobId: IsString, state: IsLiteral("queued")})
const IsLeased = IsObject({jobId: IsString, state: IsLiteral("leased"), lease: IsObject({owner: IsString, until: IsNumber})})
const JobsTable = GGDynamoDbTableSpec.define({
    name: "jobs",
    schema: IsDiscriminated("state", {queued: IsQueued, leased: IsLeased}),
    pk: "jobId",
    derived: d => ({
        queued: d.flag(["state"], r => r.state === "queued", {value: "q"}).readable(),
    }),
    indexes: {queued: {pk: "queued", sk: "jobId"}},
})

describe("object key inputs, union rows and nested paths against dynamodb-local", () => {
    const client = new DynamoDBClient({endpoint: ENDPOINT, region: "eu-west-1", credentials: {accessKeyId: `shapes${Date.now()}`, secretAccessKey: "x"}})
    const db = GGDynamoDb.forClient(client)
    beforeAll(() => GGDynamoDbDevTables.ensure(client, [GrantsTable, JobsTable]))
    afterAll(() => client.destroy())

    test("a key computed from a map field holds only for the map it was written with", async () => {
        const grants = new GGDynamoDbTypedTable(db, GrantsTable)
        const alice = {orgId: "o1", principal: {kind: "user", id: "alice"}}
        await grants.put({...alice, role: "admin"})
        await expect(grants.get({orgId: "o1", principal: {id: "alice", kind: "user"}})).resolves.toMatchObject({role: "admin"})
        // bob's key computes to alice's: the stored map tells them apart.
        const bob = {orgId: "o1", principal: {kind: "user", id: "bob"}}
        await expect(grants.get(bob)).resolves.toBeUndefined()
        await expect(grants.update(bob, {role: "viewer"})).resolves.toBeUndefined()
        await expect(grants.update({orgId: "o1", principal: {id: "alice", kind: "user"}}, {role: "viewer"})).resolves.toMatchObject({role: "viewer"})
        await expect(grants.delete(bob)).resolves.toBe(false)
    })

    test("a union row is stored per variant, read back with its readable flag, and conditioned on a nested path", async () => {
        const jobs = new GGDynamoDbTypedTable(db, JobsTable)
        await jobs.put({jobId: "j1", state: "queued"})
        await expect(jobs.index.queued.query()).resolves.toEqual([{jobId: "j1", state: "queued", queued: "q"}])
        await jobs.put({jobId: "j1", state: "leased", lease: {owner: "w1", until: 10}})
        await expect(jobs.index.queued.query()).resolves.toEqual([])
        await expect(jobs.delete("j1", {if: {"lease.owner": {eq: "w2"}}})).resolves.toBe(false)
        await expect(jobs.take("j1", {if: {"lease.owner": {eq: "w1"}, "lease.until": {gte: 10}}})).resolves.toEqual({jobId: "j1", state: "leased", lease: {owner: "w1", until: 10}})
    })
})
