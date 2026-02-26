import mysql, {Pool, ResultSetHeader, RowDataPacket} from 'mysql2/promise';
import {GGLocator, GGLocatorServiceType} from '@grest-ts/locator';
import {GGLog} from '@grest-ts/logger';
import {GGMysqlConnection} from './GGMysqlConnection';
import type {GGMysqlConfig} from "./GGMysqlConfig";

export class GGMysql {

    private readonly config: GGMysqlConfig;

    private started = false;

    private pool: Pool | undefined = null;
    private unwatchHost: (() => void) | undefined = undefined;
    private unwatchUser: (() => void) | undefined = undefined;

    constructor(config: GGMysqlConfig) {
        this.config = config

        this.unwatchHost = this.config.host.watch(() => this.connect().catch(() => {}));
        this.unwatchUser = this.config.user.watch(() => this.connect().catch(() => {}));

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

        const newPool: Pool = mysql.createPool({
            host: config.host ?? "localhost",
            port: config.port ?? 3306,
            user: user.username,
            password: user.password,
            database: config.database,
            connectionLimit: connectionsLimit,
            waitForConnections: true,
            queueLimit: connectionsLimit * 2,
            decimalNumbers: true,
            dateStrings: true,
        });

        try {
            const conn = await newPool.getConnection();
            await conn.ping();
            conn.release();
        } catch (err) {
            GGLog.critical(this, 'Failed to connect to database!', {
                database: config.database,
                host: config.host,
                error: err instanceof Error ? err.message : String(err)
            });
            await newPool.end();
            throw err;
        }

        if (this.pool) {
            this.pool.end().catch(err => {
                GGLog.warn(this, 'Config change: error closing old pool', {
                    error: err instanceof Error ? err.message : String(err)
                });
            });
        }

        this.pool = newPool;

        GGLog.info(this, 'Mysql connected!', {database: config.database});
    }

    private async start(): Promise<void> {
        this.started = true;
        await this.connect();
    }

    private async teardown(): Promise<void> {
        this.unwatchHost();
        this.unwatchHost = undefined;
        this.unwatchUser();
        this.unwatchUser = undefined;
        if (this.pool) {
            await this.pool.end();
            this.pool = undefined;
            GGLog.debug(this, 'disconnected');
        }
    }

    private getPool(): Pool {
        if (!this.pool) {
            throw new Error(`Mysql '${this.config.name}' not connected. Are you calling this before runtime.start()?`);
        }
        return this.pool;
    }

    public async query<T extends RowDataPacket[]>(sql: string, params?: unknown[]): Promise<T> {
        GGLog.debug(this, 'query', {sql, params});
        const [rows] = await this.getPool().query<T>(sql, params as any);
        GGLog.debug(this, 'query result', {rowCount: rows.length});
        return rows;
    }

    public async execute(sql: string, params?: unknown[]): Promise<ResultSetHeader> {
        GGLog.debug(this, 'execute', {sql, params});
        const [result] = await this.getPool().execute<ResultSetHeader>(sql, params as any);
        GGLog.debug(this, 'execute result', {affectedRows: result.affectedRows, insertId: result.insertId});
        return result;
    }

    // ==================== Connection for transactions ====================

    /**
     * Get a dedicated connection from the pool.
     * Use this for transactions or when you need multiple queries on the same connection.
     *
     * IMPORTANT: Always call release() on the connection when done.
     */
    public async getConnection(): Promise<GGMysqlConnection> {
        const poolConn = await this.getPool().getConnection();
        return new GGMysqlConnection(poolConn);
    }

    /**
     * Run a callback within a transaction.
     * Automatically handles connection lifecycle, commits on success, rolls back on failure.
     */
    public async runInTransaction<T>(callback: (conn: GGMysqlConnection) => Promise<T>): Promise<T> {
        const conn = await this.getConnection();
        try {
            return await conn.runInTransaction(() => callback(conn));
        } finally {
            conn.release();
        }
    }
}
