import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient} from "@aws-sdk/lib-dynamodb"
import {GGDynamoDbHostData, GGDynamoDbUserData} from "@grest-ts/db-dynamodb"
import {GGDynamoDbConnection, GGDynamoDbTableOperations} from "./GGDynamoDbTableOperations"

export interface GGDynamoDbSetupClients {
    /** Low-level SDK client. Use for control-plane (CreateTable etc) and
     *  raw item operations. */
    client: DynamoDBClient
    /** Document client (auto-marshals JS objects ↔ DDB types). Use for
     *  PutCommand / GetCommand / etc. when seeding baseline rows. */
    doc: DynamoDBDocumentClient
}

/**
 * Caller-provided schema setup. Receives both a raw DynamoDBClient and
 * the document-client wrapper, both bound to the per-group accessKey.
 * Expected to create whatever tables the tests need and seed any
 * baseline rows that should be present for every test in the group.
 * Called once per group per test run.
 *
 * Unlike MySQL's `cloneSchema` which copies structure from a populated
 * source DB, DynamoDB schemas live in code (CreateTableCommand calls), so
 * callers pass the canonical creation function directly — the source-DB
 * round-trip would be lossy and pointless.
 */
export type GGDynamoDbSetupFn = (clients: GGDynamoDbSetupClients) => Promise<void>

export interface GGDynamoDbProvisionOptions {
    /** Schema + baseline-rows setup. Called once per group. */
    setup: GGDynamoDbSetupFn
}

export class GGDynamoDbSchemaCloner {

    /**
     * Provision a per-group DynamoDB by running the caller's `setup` with a
     * client bound to a unique (accessKeyId, region) pair. Returns the
     * connection details the runtime should use — pushed into config via the
     * testkit's IPC bridge so the running runtime sees an isolated database.
     */
    public static async provision(
        host: GGDynamoDbHostData,
        accessKeyId: string,
        opts: GGDynamoDbProvisionOptions,
    ): Promise<{host: GGDynamoDbHostData, user: GGDynamoDbUserData}> {

        if (!host?.endpoint) {
            throw new Error("GGDynamoDb testkit requires an `endpoint` — point at a dynamodb-local running without -sharedDb.")
        }
        if (!host?.region) {
            throw new Error("GGDynamoDb testkit requires a `region` (used as part of the per-test database key).")
        }

        // dynamodb-local doesn't validate credentials; the secretAccessKey just
        // has to be non-empty to satisfy the AWS SDK signer.
        const connection: GGDynamoDbConnection = {
            endpoint: host.endpoint,
            region: host.region,
            accessKeyId,
            secretAccessKey: "test",
        }
        const ops = new GGDynamoDbTableOperations(connection)
        try {
            await opts.setup({client: ops.client, doc: ops.docClient})
        } finally {
            ops.destroy()
        }

        return {
            host: {endpoint: host.endpoint, region: host.region},
            user: {accessKeyId, secretAccessKey: "test"},
        }
    }

    /**
     * Drop every table visible under the per-group (accessKeyId, region)
     * pair. Run in afterAll. -inMemory instances would forget on the next
     * process restart anyway, but explicit cleanup keeps things tidy
     * across many runs in the same long-lived dynamodb-local.
     */
    public static async cleanup(host: GGDynamoDbHostData, accessKeyId: string): Promise<void> {
        if (!host?.endpoint || !host?.region) return // nothing to clean
        const ops = new GGDynamoDbTableOperations({
            endpoint: host.endpoint,
            region: host.region,
            accessKeyId,
            secretAccessKey: "test",
        })
        try {
            await ops.dropAllTables()
        } finally {
            ops.destroy()
        }
    }
}
