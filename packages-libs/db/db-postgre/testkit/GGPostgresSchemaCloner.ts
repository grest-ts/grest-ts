import {GGPostgresSchemaOperations} from './GGPostgresSchemaOperations';
import {GGPostgresHostData, GGPostgresUserData} from "../src/GGPostgresConfig";

export interface GGPostgresCloneOptions {
    /** SQL files to seed the test schema after cloning */
    seedFiles?: string[];
    /** SQL schema file to create the source schema if it doesn't exist */
    schemaFile?: string;
}

export class GGPostgresSchemaCloner {

    public static async clone(sourceConfig: GGPostgresHostData, credentials: GGPostgresUserData, schemaName: string, options?: GGPostgresCloneOptions | string[]): Promise<GGPostgresHostData> {
        // Handle backward compatibility: if options is an array, treat it as sqlFiles
        const opts: GGPostgresCloneOptions = Array.isArray(options)
            ? {seedFiles: options}
            : (options ?? {});

        const ops = await this.getSchemaOps(sourceConfig, credentials);

        try {
            // If schemaFile is provided, ensure source database exists first
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

    public static async cleanup(testConfig: GGPostgresHostData, credentials: GGPostgresUserData): Promise<void> {
        const ops = await this.getSchemaOps(testConfig, credentials);
        try {
            await ops.dropSchema(testConfig.database);
        } finally {
            await ops.disconnect();
        }
    }

    private static async getSchemaOps(config: GGPostgresHostData, credentials: GGPostgresUserData): Promise<GGPostgresSchemaOperations> {
        const schemaOps = new GGPostgresSchemaOperations({
            host: config.host,
            port: config.port,
            user: credentials.username,
            password: credentials.password,
        });

        await schemaOps.connect();
        return schemaOps;
    }
}
