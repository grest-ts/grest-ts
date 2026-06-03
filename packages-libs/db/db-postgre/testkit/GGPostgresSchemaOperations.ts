import {Client} from 'pg';
import * as fs from 'fs';
import * as path from 'path';

export interface GGPostgresSchemaOperationsConfig {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
}

export class GGPostgresSchemaOperations {
    private client: Client | null = null;
    private config: GGPostgresSchemaOperationsConfig;

    constructor(config: GGPostgresSchemaOperationsConfig) {
        this.config = config;
    }

    async connect(): Promise<void> {
        if (this.client) {
            return;
        }
        this.client = new Client({
            host: this.config.host,
            port: this.config.port,
            user: this.config.user,
            password: this.config.password,
            database: 'postgres', // Connect to default database for schema operations
        });
        await this.client.connect();
    }

    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.end();
            this.client = null;
        }
    }

    private getClient(): Client {
        if (!this.client) {
            throw new Error('PostgresSchemaOperations not connected. Call connect() first.');
        }
        return this.client;
    }

    // ==================== Schema operations ====================

    async schemaExists(schema: string): Promise<boolean> {
        const result = await this.getClient().query(
            `SELECT datname FROM pg_database WHERE datname = $1`,
            [schema]
        );
        return result.rows.length > 0;
    }

    async createSchema(schema: string): Promise<void> {
        // PostgreSQL requires connecting to postgres db to create new databases
        // Handle race condition where multiple tests try to create the same database
        try {
            await this.getClient().query(`CREATE DATABASE "${schema}"`);
        } catch (err: any) {
            // Ignore "database already exists" error (code 42P04)
            if (err.code !== '42P04') {
                throw err;
            }
        }
    }

    async dropSchema(schema: string): Promise<void> {
        // Terminate all connections to the database before dropping
        await this.getClient().query(`
            SELECT pg_terminate_backend(pg_stat_activity.pid)
            FROM pg_stat_activity
            WHERE pg_stat_activity.datname = $1
              AND pid <> pg_backend_pid()
        `, [schema]);

        await this.getClient().query(`DROP DATABASE IF EXISTS "${schema}"`);
    }

    async cloneSchema(sourceSchema: string, targetSchema: string): Promise<void> {
        // PostgreSQL can clone databases using TEMPLATE
        // First ensure no connections to source database
        await this.getClient().query(`
            SELECT pg_terminate_backend(pg_stat_activity.pid)
            FROM pg_stat_activity
            WHERE pg_stat_activity.datname = $1
              AND pid <> pg_backend_pid()
        `, [sourceSchema]);

        await this.getClient().query(
            `CREATE DATABASE "${targetSchema}" TEMPLATE "${sourceSchema}"`
        );
    }

    // ==================== Seed ====================

    async runSeedFiles(schema: string, seedFiles: string[]): Promise<void> {
        // Need to connect to the target database for seeding
        const seedClient = new Client({
            host: this.config.host,
            port: this.config.port,
            user: this.config.user,
            password: this.config.password,
            database: schema,
        });

        await seedClient.connect();

        try {
            for (const seedFile of seedFiles) {
                const filePath = path.resolve(process.cwd(), seedFile);

                if (!fs.existsSync(filePath)) {
                    throw new Error(`Seed file not found: ${filePath}`);
                }

                const sql = fs.readFileSync(filePath, 'utf-8');

                // Remove comment lines first, then split by semicolons
                const cleanedSql = sql
                    .split('\n')
                    .filter(line => !line.trim().startsWith('--'))
                    .join('\n');

                const statements = cleanedSql
                    .split(';')
                    .map(s => s.trim())
                    .filter(s => s.length > 0);

                for (const statement of statements) {
                    await seedClient.query(statement);
                }
            }
        } finally {
            await seedClient.end();
        }
    }
}
