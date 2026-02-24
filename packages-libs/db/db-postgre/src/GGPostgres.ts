import {Pool, QueryResult, QueryResultRow} from 'pg';
import {GGLocator, GGLocatorServiceType} from '@grest-ts/locator';
import {GGLog} from '@grest-ts/logger';
import {GGPostgresConnection} from './GGPostgresConnection';
import type {GGPostgresConfig} from "./GGPostgresConfig";

export class GGPostgres {

    private readonly config: GGPostgresConfig;

    private started = false;

    private pool: Pool | undefined = undefined;
    private unwatchHost: (() => void) | undefined = undefined;
    private unwatchUser: (() => void) | undefined = undefined;

    constructor(config: GGPostgresConfig) {
        this.config = config

        this.unwatchHost = this.config.host.watch(() => this.connect());
        this.unwatchUser = this.config.user.watch(() => this.connect());

        GGLocator.getScope().setWithLifecycle(this.config.token, this, {
            type: GGLocatorServiceType.DATABASE,
            start: () => this.start(),
            teardown: () => this.teardown(),
        });
    }

    private async connect(): Promise<void> {
        if (!this.started) {
            return;
        }

        const config = this.config.host.get();
        const user = this.config.user.reveal();
        const connectionsLimit = config.connectionLimit ?? 20;

        const newPool = new Pool({
            host: config.host ?? "localhost",
            port: config.port ?? 5432,
            user: user.username,
            password: user.password,
            database: config.database,
            max: connectionsLimit,
        });

        try {
            const client = await newPool.connect();
            await client.query('SELECT 1');
            client.release();
        } catch (err) {
            GGLog.critical(this, 'Failed to connect to pool! Must resolve immediately, new services will fail to start!', {
                database: config.database,
                host: config.host,
                error: err instanceof Error ? err.message : String(err)
            });
            await newPool.end();
            return;
        }

        if (this.pool) {
            this.pool.end().catch(err => {
                GGLog.warn(this, 'Config change: error closing old pool', {
                    error: err instanceof Error ? err.message : String(err)
                });
            });
        }

        this.pool = newPool;

        GGLog.info(this, 'Postgres connected!', {database: config.database});
    }

    private async start(): Promise<void> {
        this.started = true;
        await this.connect();
    }

    private async teardown(): Promise<void> {
        this.unwatchHost?.();
        this.unwatchHost = undefined;
        this.unwatchUser?.();
        this.unwatchUser = undefined;
        if (this.pool) {
            await this.pool.end();
            this.pool = undefined;
            GGLog.debug(this, 'disconnected');
        }
    }

    private getPool(): Pool {
        if (!this.pool) {
            throw new Error(`Postgres '${this.config.name}' not connected. Are you calling this before runtime.start()?`);
        }
        return this.pool;
    }

    public async query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
        GGLog.debug(this, 'query', {sql, params});
        const result: QueryResult<T> = await this.getPool().query<T>(sql, params);
        GGLog.debug(this, 'query result', {rowCount: result.rowCount});
        return result.rows;
    }

    public async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
        GGLog.debug(this, 'execute', {sql, params});
        const result = await this.getPool().query(sql, params);
        GGLog.debug(this, 'execute result', {rowCount: result.rowCount});
        return result;
    }

    // ==================== Connection for transactions ====================

    /**
     * Get a dedicated connection from the pool.
     * Use this for transactions or when you need multiple queries on the same connection.
     *
     * IMPORTANT: Always call release() on the connection when done.
     */
    public async getConnection(): Promise<GGPostgresConnection> {
        const client = await this.getPool().connect();
        return new GGPostgresConnection(client);
    }

    /**
     * Run a callback within a transaction.
     * Automatically handles connection lifecycle, commits on success, rolls back on failure.
     */
    public async runInTransaction<T>(callback: (conn: GGPostgresConnection) => Promise<T>): Promise<T> {
        const conn = await this.getConnection();
        try {
            return await conn.runInTransaction(() => callback(conn));
        } finally {
            conn.release();
        }
    }
}
