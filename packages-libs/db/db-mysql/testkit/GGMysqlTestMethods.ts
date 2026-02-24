import {GG_TEST_RESOURCE, GG_TEST_RUNNER, GGTestSharedRef, callOn, LocatorLookupAccess} from "@grest-ts/testkit";
import {GGMysqlCloneOptions, GGMysqlSchemaCloner} from "./GGMysqlSchemaCloner";
import {GGMysqlConfig, GGMysqlHostData, GGMysqlUserData} from "../src/GGMysqlConfig";
import {GGMysql} from "../src/GGMysql";
import {GGConfigIPC} from "@grest-ts/config/testkit";

export interface GGMysqlCloneTestOptions {
    /** SQL files to seed the test schema after cloning */
    seedFiles?: string[];
    /** Source database config and credentials. Required when GGResource has no default value (e.g. when using createLocalConfig). */
    from?: { host: GGMysqlHostData, user: GGMysqlUserData };
    /** Group name for shared DB cloning across workers. Tests with the same group share one clone. */
    group?: string;
}

export class GGMysqlTestMethods {

    constructor(private readonly config: GGMysqlConfig) {
    }

    /**
     * Clones the database schema for test isolation.
     *
     * If the source database doesn't exist and a schemaFile is configured
     * in GGMysqlConfig, it will be created automatically.
     *
     * @param options - Optional seed files to populate the test database
     *
     * @example
     * // Basic usage (uses schemaFile from config if database doesn't exist):
     * GGTest.with(ChecklistConfig.resources.mysql).clone();
     *
     * // With seed files:
     * GGTest.with(ChecklistConfig.resources.mysql).clone("seed.sql");
     * GGTest.with(ChecklistConfig.resources.mysql).clone(["seed1.sql", "seed2.sql"]);
     *
     * // With explicit source config (when GGResource has no default):
     * GGTest.with(MyConfig.mysql).clone({from: mysqlLocalConfig, seedFiles: ["seed.sql"]});
     *
     * // Shared clone across workers:
     * GGTest.with(MyConfig.mysql).clone({from: mysqlLocalConfig, group: "shared"});
     */
    public clone(options?: string | string[] | GGMysqlCloneTestOptions): LocatorLookupAccess<GGMysql> {

        const test = GG_TEST_RUNNER.get();

        // Normalize options to GGMysqlCloneOptions
        let cloneOptions: GGMysqlCloneOptions = {};
        let from: { host: GGMysqlHostData, user: GGMysqlUserData } | undefined;
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
                `Either set a default value on GGResource, or pass {from: mysqlLocalConfig} in clone options.`
            );
        }
        if (!credentials) {
            throw new Error(
                `Cannot determine database credentials for ${this.config.user.name}. ` +
                `Either set a default value on GGSecret, or pass {from: mysqlLocalConfig} in clone options.`
            );
        }

        const runId = process.env.GG_TEST_RUN_ID;
        if (!runId) {
            throw new Error("GG_TEST_RUN_ID not set. Add globalSetup '@grest-ts/testkit-vitest/globalSetup' to vitest.config.ts.");
        }

        const groupName = group ?? test.testId;
        const schemaName = `${sourceConfig.database}_${runId}_${groupName}`;

        let clonedConfig: GGMysqlHostData;
        test.registerHook({
            keyName: this.config.host.name,
            beforeAll: async () => {
                await GGTestSharedRef.acquire(schemaName, async () => {
                    await GGMysqlSchemaCloner.clone(sourceConfig, credentials, schemaName, cloneOptions);
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
                    await GGMysqlSchemaCloner.cleanup(clonedConfig, credentials);
                });
            }
        });

        return callOn(this.config.token);
    }

}

const testMethodsCache = new WeakMap<GGMysqlConfig, GGMysqlTestMethods>();

Object.defineProperty(GGMysqlConfig.prototype, GG_TEST_RESOURCE, {
    get(this: GGMysqlConfig) {
        let methods = testMethodsCache.get(this);
        if (!methods) {
            methods = new GGMysqlTestMethods(this);
            testMethodsCache.set(this, methods);
        }
        return methods;
    },
    configurable: true
});

declare module "../src/GGMysqlConfig" {
    interface GGMysqlConfig {
        [GG_TEST_RESOURCE]: GGMysqlTestMethods;
    }
}
