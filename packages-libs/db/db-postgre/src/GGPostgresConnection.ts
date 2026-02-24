import {PoolClient, QueryResult, QueryResultRow} from 'pg';
import {GGLog} from '@grest-ts/logger';

/**
 * PostgresConnection - A single connection from the pool.
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
export class GGPostgresConnection {
    private client: PoolClient;
    private released = false;

    constructor(client: PoolClient) {
        this.client = client;
    }

    /**
     * Execute a SELECT query and return rows.
     */
    async query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
        this.checkReleased();
        GGLog.debug(this, 'query', {sql, params});
        const result: QueryResult<T> = await this.client.query<T>(sql, params);
        GGLog.debug(this, 'query result', {rowCount: result.rowCount});
        return result.rows;
    }

    /**
     * Execute an INSERT, UPDATE, or DELETE query.
     */
    async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
        this.checkReleased();
        GGLog.debug(this, 'execute', {sql, params});
        const result = await this.client.query(sql, params);
        GGLog.debug(this, 'execute result', {rowCount: result.rowCount});
        return result;
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
        await this.client.query('BEGIN');
        GGLog.debug(this, 'beginTransaction');
        try {
            const result = await callback();
            await this.client.query('COMMIT');
            GGLog.debug(this, 'commit');
            return result;
        } catch (err) {
            await this.client.query('ROLLBACK');
            GGLog.debug(this, 'rollback', {error: err});
            throw err;
        }
    }

    /**
     * Start a transaction.
     */
    async beginTransaction(): Promise<void> {
        this.checkReleased();
        GGLog.debug(this, 'beginTransaction');
        await this.client.query('BEGIN');
    }

    /**
     * Commit the current transaction.
     */
    async commit(): Promise<void> {
        this.checkReleased();
        GGLog.debug(this, 'commit');
        await this.client.query('COMMIT');
    }

    /**
     * Rollback the current transaction.
     */
    async rollback(): Promise<void> {
        this.checkReleased();
        GGLog.debug(this, 'rollback');
        await this.client.query('ROLLBACK');
    }

    // ==================== Lifecycle ====================

    /**
     * Release this connection back to the pool.
     * MUST be called when done with the connection.
     */
    release(): void {
        if (!this.released) {
            this.client.release();
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
