import {GGMysqlSchemaOperations} from './GGMysqlSchemaOperations';
import {GGMysqlHostData, GGMysqlUserData} from "../src/GGMysqlConfig";

export interface GGMysqlCloneOptions {
    /** SQL files to seed the test schema after cloning */
    seedFiles?: string[];
    /** SQL schema file to create the source schema if it doesn't exist */
    schemaFile?: string;
}

export class GGMysqlSchemaCloner {

    public static async clone(sourceConfig: GGMysqlHostData, credentials: GGMysqlUserData, schemaName: string, options?: GGMysqlCloneOptions | string[]): Promise<GGMysqlHostData> {
        // Handle backward compatibility: if options is an array, treat it as sqlFiles
        const opts: GGMysqlCloneOptions = Array.isArray(options)
            ? {seedFiles: options}
            : (options ?? {});

        const ops = await this.getSchemaOps(sourceConfig, credentials);

        try {
            // If schemaFile is provided, ensure source schema exists first
            if (opts.schemaFile) {
                const exists = await ops.schemaExists(sourceConfig.database);
                if (!exists) {
                    await ops.createSchema(sourceConfig.database);
                    await ops.runSeedFiles(sourceConfig.database, [opts.schemaFile]);
                }
            }

            await ops.cloneSchema(sourceConfig.database, schemaName);

            if (opts.seedFiles?.length) {
                await ops.runSeedFiles(schemaName, opts.seedFiles);
            }

            return {
                ...sourceConfig,
                database: schemaName,
            };
        } finally {
            await ops.disconnect();
        }
    }

    public static async cleanup(testConfig: GGMysqlHostData, credentials: GGMysqlUserData): Promise<void> {
        const ops = await this.getSchemaOps(testConfig, credentials);
        try {
            await ops.dropSchema(testConfig.database);
        } finally {
            await ops.disconnect();
        }
    }

    private static async getSchemaOps(config: GGMysqlHostData, credentials: GGMysqlUserData): Promise<GGMysqlSchemaOperations> {
        const schemaOps = new GGMysqlSchemaOperations({
            host: config.host,
            port: config.port,
            user: credentials.username,
            password: credentials.password,
        });
        await schemaOps.connect();
        return schemaOps;
    }
}
