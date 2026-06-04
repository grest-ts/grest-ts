import {GG_TEST_RESOURCE, GG_TEST_RUNNER, GGTestSharedRef, callOn, LocatorLookupAccess} from "@grest-ts/testkit"
import {GGConfigIPC} from "@grest-ts/config/testkit"
import {GGDynamoDbConfig, GGDynamoDbHostData} from "@grest-ts/db-dynamodb"
import {GGDynamoDb} from "@grest-ts/db-dynamodb"
import {GGDynamoDbProvisionOptions, GGDynamoDbSchemaCloner, GGDynamoDbSetupFn} from "./GGDynamoDbSchemaCloner"

export interface GGDynamoDbCloneTestOptions {
    /** Schema + baseline-rows setup. Receives a `DynamoDBDocumentClient`
     *  bound to this group's per-test accessKey; expected to create tables
     *  and seed any rows shared across all tests in the group. */
    setup: GGDynamoDbSetupFn

    /** dynamodb-local endpoint to use. The instance MUST be running without
     *  -sharedDb — schema-equivalent isolation is achieved by per-test
     *  accessKeyId, which only works when the daemon keeps separate
     *  database files per credential pair. */
    host: GGDynamoDbHostData

    /** Group name for shared isolation across workers. Tests with the same
     *  group share one accessKey (and therefore one isolated database);
     *  different groups get different accessKeys. Defaults to the test
     *  runner's testId, i.e. each test suite gets its own group. */
    group?: string
}

export class GGDynamoDbTestMethods {

    private readonly config: GGDynamoDbConfig

    constructor(config: GGDynamoDbConfig) {
        this.config = config
    }

    /**
     * Provision a per-group isolated DynamoDB for tests.
     *
     * Unlike the MySQL testkit (which clones structure from a populated
     * source DB), DynamoDB schemas live in code — there's no separate
     * "schema object" to copy. Callers pass a `setup` function that owns
     * table creation + baseline seeding. The testkit picks a unique
     * accessKeyId per group, runs `setup` against an isolated database,
     * IPC-pushes the new credentials into the running runtime, and drops
     * everything in afterAll.
     *
     * @example
     * GGTest.with(MyConfig.dynamo).clone({
     *     host: {endpoint: "http://localhost:8001", region: "eu-west-1"},
     *     setup: async client => {
     *         await client.send(new CreateTableCommand({...}))
     *         await client.send(new PutCommand({...}))
     *     },
     * })
     */
    public clone(options: GGDynamoDbCloneTestOptions): LocatorLookupAccess<GGDynamoDb> {
        const test = GG_TEST_RUNNER.get()

        const host = options.host
        if (!host?.endpoint) {
            throw new Error(`GGDynamoDb testkit: clone({host: {endpoint, region}}) is required (got ${JSON.stringify(host)}).`)
        }

        const runId = process.env.GG_TEST_RUN_ID
        if (!runId) {
            throw new Error("GG_TEST_RUN_ID not set. Add globalSetup '@grest-ts/testkit-vitest/globalSetup' to vitest.config.ts.")
        }

        const groupName = options.group ?? test.testId
        // dynamodb-local accepts arbitrary accessKey strings. We just need
        // it to be unique per group + safe as a key derivation seed.
        const accessKeyId = sanitizeAccessKey(`gg-test-${runId}-${groupName}`)

        const provisionOpts: GGDynamoDbProvisionOptions = {setup: options.setup}

        let provisionedHost: GGDynamoDbHostData = host
        let provisionedAccessKey: string = accessKeyId

        test.registerHook({
            keyName: this.config.host.name,
            beforeAll: async () => {
                await GGTestSharedRef.acquire(`${this.config.name}:${accessKeyId}`, async () => {
                    const result = await GGDynamoDbSchemaCloner.provision(host, accessKeyId, provisionOpts)
                    provisionedHost = result.host
                    provisionedAccessKey = result.user.accessKeyId!
                })
                // Push host + user overrides into the runtime via testkit's
                // config IPC bridge — same mechanism the MySQL testkit uses
                // to swap the active `database`. The runtime's GGDynamoDb
                // watches both keys and rebuilds its SDK client when either
                // changes.
                await test.sendCommand(GGConfigIPC.worker.update, {
                    storeName: this.config.host.getStoreKey(),
                    keyName: this.config.host.name,
                    value: provisionedHost,
                })
                await test.sendCommand(GGConfigIPC.worker.update, {
                    storeName: this.config.user.getStoreKey(),
                    keyName: this.config.user.name,
                    value: {accessKeyId: provisionedAccessKey, secretAccessKey: "test"},
                })
            },
            afterAll: async () => {
                await GGTestSharedRef.release(`${this.config.name}:${accessKeyId}`, async () => {
                    await GGDynamoDbSchemaCloner.cleanup(provisionedHost, provisionedAccessKey)
                })
            },
        })

        return callOn(this.config.token)
    }
}

function sanitizeAccessKey(s: string): string {
    // dynamodb-local rejects access keys with anything outside
    // [A-Za-z0-9] (with or without -sharedDb). Strip everything else and
    // upper-case to look like a real AWS key, which both the SDK and
    // the daemon are happy with.
    return s.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 128)
}

const testMethodsCache = new WeakMap<GGDynamoDbConfig, GGDynamoDbTestMethods>()

Object.defineProperty(GGDynamoDbConfig.prototype, GG_TEST_RESOURCE, {
    get(this: GGDynamoDbConfig) {
        let methods = testMethodsCache.get(this)
        if (!methods) {
            methods = new GGDynamoDbTestMethods(this)
            testMethodsCache.set(this, methods)
        }
        return methods
    },
    configurable: true,
})

declare module "@grest-ts/db-dynamodb" {
    interface GGDynamoDbConfig {
        [GG_TEST_RESOURCE]: GGDynamoDbTestMethods
    }
}
