import {GGRuntime} from "@grest-ts/runtime"
import {GGConfig, GGConfigLocator, GGConfigStoreLocal, GGResource, GGSecret} from "@grest-ts/config"
import {IsArray, IsLiteral, IsNumber, IsObject, IsString} from "@grest-ts/schema"
import {GGDynamoDbConfig} from "../src/GGDynamoDbConfig"
import type {GGDynamoDb} from "../src/GGDynamoDb"
import {GGDynamoDbTableSpec} from "../src/GGDynamoDbTableSpec"
import {GGDynamoDbTypedTable, type GGDynamoDbTableOf} from "../src/GGDynamoDbTypedTable"

export const ENDPOINT = process.env.DYNAMODB_TEST_ENDPOINT ?? "http://localhost:8002"

export const IsWorkspace = IsObject({
    workspaceId: IsString,
    orgId: IsString,
    userId: IsString.orUndefined,
    status: IsLiteral("running", "stopped", "deleted"),
    createdAt: IsNumber,
    name: IsString.orUndefined,
    pendingOp: IsString.orUndefined,
    endedAt: IsNumber.orUndefined,
    tags: IsArray(IsString).orUndefined,
    opCount: IsNumber.orUndefined,
    version: IsNumber,
})
export type Workspace = typeof IsWorkspace.infer

export const WorkspacesTable = GGDynamoDbTableSpec.define({
    name: "workspaces",
    schema: IsWorkspace,
    pk: "workspaceId",
    sets: ["tags"],
    derived: d => ({
        orgUser: d.join("orgId", "userId"),
        liveOrg: d.join("orgId").when(["status"], r => r.status !== "deleted"),
        flowPending: d.flag(["pendingOp"], r => !!r.pendingOp),
        activeUntil: d.number(["endedAt"], r => r.endedAt ?? Number.MAX_SAFE_INTEGER),
    }),
    indexes: {
        byOrgUser: {pk: "orgUser", sk: "status"},
        liveByOrg: {pk: "liveOrg", sk: "createdAt", projection: ["name", "status"]},
        pendingFlows: {pk: "flowPending", projection: "KEYS_ONLY"},
        byActiveUntil: {pk: "orgId", sk: "activeUntil"},
    },
})

export const IsEvent = IsObject({streamId: IsString, seq: IsNumber, kind: IsString.orUndefined, count: IsNumber.orUndefined})

export const EventsTable = GGDynamoDbTableSpec.define({name: "events", schema: IsEvent, pk: "streamId", sk: "seq"})

export const IsUsage = IsObject({
    userId: IsString,
    orgId: IsString,
    provider: IsString,
    day: IsString,
    seconds: IsNumber.orUndefined,
    firstAt: IsNumber.orUndefined,
    purgeAt: IsNumber.orUndefined,
    status: IsString.orUndefined,
    notes: IsArray(IsString).orUndefined,
    limits: IsObject({daily: IsNumber.orUndefined, monthly: IsNumber.orUndefined}).orUndefined,
})

export const UsageTable = GGDynamoDbTableSpec.define({
    name: "usage",
    schema: IsUsage,
    pk: "userId",
    sk: "providerDay",
    ttl: "purgeAt",
    derived: d => ({providerDay: d.join("orgId", "provider", "day")}),
    indexes: {byStatus: {pk: "userId", sk: "status", local: true}},
})

export const IsDoc = IsObject({
    docId: IsString,
    title: IsString,
    expiresAt: IsNumber,
    version: IsNumber.orUndefined,
})
export type Doc = typeof IsDoc.infer

export const DocsTable = GGDynamoDbTableSpec.define({
    name: "docs",
    schema: IsDoc,
    pk: "docId",
    version: "version",
    ttl: "purgeAtSec",
    derived: d => ({purgeAtSec: d.number(["expiresAt"], r => Math.floor(r.expiresAt / 1000))}),
})

export class DocStore extends GGDynamoDbTypedTable.of(DocsTable) {
    rename(docId: string, title: string, version: number) {
        return this.update(docId, {title}, {expectVersion: version})
    }
}

export const TypedTableTestConfig = GGConfig.define("/db_dynamodb_typed_test/", () => ({
    db: new GGDynamoDbConfig("db"),
}))

export let db: GGDynamoDb
export let workspaces: GGDynamoDbTableOf<typeof WorkspacesTable>
export let events: GGDynamoDbTableOf<typeof EventsTable>
export let usage: GGDynamoDbTableOf<typeof UsageTable>
export let docs: DocStore

export class TypedTableTestRuntime extends GGRuntime {
    public static readonly NAME = "db-dynamodb-typed-test"

    protected compose(): void {
        new GGConfigLocator(TypedTableTestConfig)
            .add([GGResource, GGSecret], new GGConfigStoreLocal(TypedTableTestConfig, {
                db: {host: {endpoint: ENDPOINT, region: "eu-west-1"}, user: {accessKeyId: undefined, secretAccessKey: undefined}},
            }))
        db = TypedTableTestConfig.db.newDynamoDb()
        workspaces = new GGDynamoDbTypedTable(db, WorkspacesTable)
        events = new GGDynamoDbTypedTable(db, EventsTable)
        usage = new GGDynamoDbTypedTable(db, UsageTable)
        docs = new DocStore(db)
    }
}

TypedTableTestRuntime.cli(import.meta.url).then()
