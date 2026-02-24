import {GG_TEST_RESOURCE, GG_TEST_RUNNER, GGTestSharedRef, callOn, LocatorLookupAccess} from "@grest-ts/testkit";
import {GGPostgresCloneOptions, GGPostgresSchemaCloner} from "./GGPostgresSchemaCloner";
import {GGPostgresConfig, GGPostgresHostData, GGPostgresUserData} from "../src/GGPostgresConfig";
import {GGPostgres} from "../src/GGPostgres";
import {GGConfigIPC} from "@grest-ts/config/testkit";

export interface GGPostgresCloneTestOptions {
    /** SQL files to seed the test schema after cloning */
    seedFiles?: string[];
    /** Source database config and credentials. Required when GGResource has no default value (e.g. when using createLocalConfig). */
    from?: {host: GGPostgresHostData, user: GGPostgresUserData};
    /** Group name for shared DB cloning across workers. Tests with the same group share one clone. */
    group?: string;
}

export class GGPostgresTestMethods {

    constructor(private readonly config: GGPostgresConfig) {
    }

    /**
     * Clones the database for test isolation.
     *
     * If the source database doesn't exist and a schemaFile is configured
     * in GGPostgresConfig, it will be created automatically.
     *
     * @param options - Optional seed files to populate the test database
     *
     * @example
     * // Basic usage (uses schemaFile from config if database doesn't exist):
     * GGTest.with(ChecklistConfig.resources.postgres).clone();
     *
     * // With seed files:
     * GGTest.with(ChecklistConfig.resources.postgres).clone("seed.sql");
     * GGTest.with(ChecklistConfig.resources.postgres).clone(["seed1.sql", "seed2.sql"]);
     *
     * // Shared clone across workers:
     * GGTest.with(MyConfig.postgres).clone({from: pgLocalConfig, group: "shared"});
     */
    public clone(options?: string | string[] | GGPostgresCloneTestOptions): LocatorLookupAccess<GGPostgres> {
        const test = GG_TEST_RUNNER.get();

        // Normalize options to GGPostgresCloneOptions
        let cloneOptions: GGPostgresCloneOptions = {};
        let from: {host: GGPostgresHostData, user: GGPostgresUserData} | undefined;
        let group: string | undefined;

        if (options) {
            if (typeof options === "string") {
                cloneOptions.seedFiles = [options];
            } else if (Array.isArray(options)) {
                cloneOptions.seedFiles = options;
            } else {
                cloneOptions.seedFiles = options.seedFiles;
                from = options.from;
                group = options.group;
            }
        }

        // Use schemaFile from config if available
        if (this.config.schemaFile) {
            cloneOptions.schemaFile = this.config.schemaFile;
        }

        const sourceConfig = from?.host;
        const credentials = from?.user;

        if (!sourceConfig) {
            throw new Error(
                `Cannot determine source database config for ${this.config.host.name}. ` +
                `Either set a default value on GGResource, or pass {from: ...} in clone options.`
            );
        }
        if (!credentials) {
            throw new Error(
                `Cannot determine database credentials for ${this.config.user.name}. ` +
                `Either set a default value on GGSecret, or pass {from: ...} in clone options.`
            );
        }

        const runId = process.env.GG_TEST_RUN_ID;
        if (!runId) {
            throw new Error("GG_TEST_RUN_ID not set. Add globalSetup '@grest-ts/testkit-vitest/globalSetup' to vitest.config.ts.");
        }

        const groupName = group ?? test.testId;
        const schemaName = `${sourceConfig.database}_${runId}_${groupName}`;

        let clonedConfig: GGPostgresHostData;
        test.registerHook({
            keyName: this.config.host.name,
            beforeAll: async () => {
                await GGTestSharedRef.acquire(schemaName, async () => {
                    await GGPostgresSchemaCloner.clone(sourceConfig, credentials, schemaName, cloneOptions);
                });
                clonedConfig = {...sourceConfig, database: schemaName};
                await test.sendCommand(GGConfigIPC.worker.update, {
                    storeName: this.config.host.getStoreKey(),
                    keyName: this.config.host.name,
                    value: clonedConfig
                });
            },
            afterAll: async () => {
                await GGTestSharedRef.release(schemaName, async () => {
                    await GGPostgresSchemaCloner.cleanup(clonedConfig, credentials);
                });
            }
        });

        return callOn(this.config.token);
    }

}

const testMethodsCache = new WeakMap<GGPostgresConfig, GGPostgresTestMethods>();

Object.defineProperty(GGPostgresConfig.prototype, GG_TEST_RESOURCE, {
    get(this: GGPostgresConfig) {
        let methods = testMethodsCache.get(this);
        if (!methods) {
            methods = new GGPostgresTestMethods(this);
            testMethodsCache.set(this, methods);
        }
        return methods;
    },
    configurable: true
});

declare module "../src/GGPostgresConfig" {
    interface GGPostgresConfig {
        [GG_TEST_RESOURCE]: GGPostgresTestMethods;
    }
}
