/**
 * Lock interface for distributed locking.
 *
 * Implementations can be:
 * - In-memory (single instance, for testing or single-server deployments)
 * - Redis-based (distributed across multiple instances)
 * - Database-based (MySQL, PostgreSQL, etc.)
 * - External services (etcd, Consul, ZooKeeper)
 *
 * The lock MUST:
 * - Have automatic expiry (TTL-based, so crashed holders don't block forever)
 * - Support renewal (extend lease while still holding)
 * - Be safe for concurrent calls
 */
export interface GGLock {
    /**
     * Try to acquire the lock. Returns true if acquired, false if already held by another.
     * MUST be atomic and safe for concurrent calls.
     *
     * @param lockId - Unique identifier for this lock
     * @param ttlMs - Time-to-live in milliseconds. Lock auto-releases after this.
     * @returns true if lock acquired, false if held by another
     */
    acquire(lockId: string, ttlMs: number): Promise<boolean>;

    /**
     * Renew the lock's TTL. Only succeeds if we still hold the lock.
     * Used for heartbeat - extend lease while processing.
     *
     * @param lockId - The lock to renew
     * @param ttlMs - New TTL from now
     * @returns true if renewed, false if lock was lost
     */
    renew(lockId: string, ttlMs: number): Promise<boolean>;

    /**
     * Release the lock explicitly. Called on graceful shutdown.
     * Should be idempotent - calling on already-released lock is OK.
     *
     * @param lockId - The lock to release
     */
    release(lockId: string): Promise<void>;
}
