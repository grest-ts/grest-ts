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

export const TypedTableTestConfig = GGConfig.define("/db_dynamodb_typed_test/", () => ({
    db: new GGDynamoDbConfig("db"),
}))

export let db: GGDynamoDb
export let workspaces: GGDynamoDbTableOf<typeof WorkspacesTable>
export let events: GGDynamoDbTableOf<typeof EventsTable>

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
    }
}

TypedTableTestRuntime.cli(import.meta.url).then()
