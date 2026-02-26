import { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { GGLog } from '@grest-ts/logger';

/**
 * MysqlConnection - A single connection from the pool.
 *
 * Use this when you need:
 * - Transactions (BEGIN, COMMIT, ROLLBACK)
 * - Multiple queries that must use the same connection
 *
 * IMPORTANT: Always call release() when done to return the connection to the pool.
 *
 * @example
 * ```typescript
 * const conn = await db.getConnection();
 * try {
 *     await conn.beginTransaction();
 *     await conn.execute('INSERT INTO users ...', [...]);
 *     await conn.execute('INSERT INTO profiles ...', [...]);
 *     await conn.commit();
 * } catch (err) {
 *     await conn.rollback();
 *     throw err;
 * } finally {
 *     conn.release();
 * }
 * ```
 */
export class GGMysqlConnection {
    private conn: PoolConnection;
    private released = false;

    constructor(conn: PoolConnection) {
        this.conn = conn;
    }

    /**
     * Execute a SELECT query and return rows.
     */
    async query<T extends RowDataPacket[]>(sql: string, params?: unknown[]): Promise<T> {
        this.checkReleased();
        GGLog.debug(this, 'query', { sql, params });
        try {
            const [rows] = await this.conn.query<T>(sql, params as any);
            GGLog.debug(this, 'query result', { rowCount: rows.length });
            return rows;
        } catch (err: any) {
            const msg = err?.message || String(err);
            throw new Error(`SQL query failed: ${msg}\n  Query: ${sql}` + (params?.length ? `\n  Params: ${JSON.stringify(params)}` : ''));
        }
    }

    /**
     * Execute an INSERT, UPDATE, or DELETE query.
     */
    async execute(sql: string, params?: unknown[]): Promise<ResultSetHeader> {
        this.checkReleased();
        GGLog.debug(this, 'execute', { sql, params });
        try {
            const [result] = await this.conn.execute<ResultSetHeader>(sql, params as any);
            GGLog.debug(this, 'execute result', { affectedRows: result.affectedRows, insertId: result.insertId });
            return result;
        } catch (err: any) {
            const msg = err?.message || String(err);
            throw new Error(`SQL execute failed: ${msg}\n  Query: ${sql}` + (params?.length ? `\n  Params: ${JSON.stringify(params)}` : ''));
        }
    }

    // ==================== Transaction methods ====================

    /**
     * Run a callback within a transaction.
     * Automatically commits on success, rolls back on failure.
     *
     * Note: Does NOT release the connection. Call release() when done.
     *
     * @example
     * ```typescript
     * const conn = await db.getConnection();
     * try {
     *     const result = await conn.runInTransaction(async () => {
     *         await conn.execute('INSERT INTO orders ...', [...]);
     *         await conn.execute('UPDATE inventory ...', [...]);
     *         return orderId;
     *     });
     * } finally {
     *     conn.release();
     * }
     * ```
     */
    async runInTransaction<T>(callback: () => Promise<T>): Promise<T> {
        this.checkReleased();
        await this.conn.beginTransaction();
        GGLog.debug(this, 'beginTransaction');
        try {
            const result = await callback();
            await this.conn.commit();
            GGLog.debug(this, 'commit');
            return result;
        } catch (err) {
            await this.conn.rollback();
            GGLog.debug(this, 'rollback', { error: err });
            throw err;
        }
    }

    /**
     * Start a transaction.
     */
    async beginTransaction(): Promise<void> {
        this.checkReleased();
        GGLog.debug(this, 'beginTransaction');
        await this.conn.beginTransaction();
    }

    /**
     * Commit the current transaction.
     */
    async commit(): Promise<void> {
        this.checkReleased();
        GGLog.debug(this, 'commit');
        await this.conn.commit();
    }

    /**
     * Rollback the current transaction.
     */
    async rollback(): Promise<void> {
        this.checkReleased();
        GGLog.debug(this, 'rollback');
        await this.conn.rollback();
    }

    // ==================== Lifecycle ====================

    /**
     * Release this connection back to the pool.
     * MUST be called when done with the connection.
     */
    release(): void {
        if (!this.released) {
            this.conn.release();
            this.released = true;
            GGLog.debug(this, 'released');
        }
    }

    /**
     * Check if connection has been released.
     */
    private checkReleased(): void {
        if (this.released) {
            throw new Error('Connection has been released. Cannot perform operations on a released connection.');
        }
    }
}
