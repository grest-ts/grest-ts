import {GGRuntime} from "@grest-ts/runtime"
import {GGConfig, GGConfigLocator, GGConfigStoreLocal, GGResource, GGSecret} from "@grest-ts/config"
import {GGDynamoDbConfig} from "@grest-ts/db-dynamodb"
import {GGDynamoDbLock} from "@grest-ts/lock-dynamodb"

export const ENDPOINT = process.env.DYNAMODB_TEST_ENDPOINT ?? "http://localhost:8001"
export const TABLE = "locks"

export const LockTestConfig = GGConfig.define("/lock_dynamodb_test/", () => ({
    db: new GGDynamoDbConfig("db"),
}))

export let lock: GGDynamoDbLock

export class LockDynamoDbTestRuntime extends GGRuntime {
    public static readonly NAME = "lock-dynamodb-test"

    protected compose(): void {
        new GGConfigLocator(LockTestConfig)
            .add([GGResource, GGSecret], new GGConfigStoreLocal(LockTestConfig, {
                db: {host: {endpoint: ENDPOINT, region: "eu-west-1"}, user: {accessKeyId: undefined, secretAccessKey: undefined}},
            }))
        lock = new GGDynamoDbLock(LockTestConfig.db.newDynamoDb(), {tableName: TABLE})
    }
}

LockDynamoDbTestRuntime.cli(import.meta.url).then()
