/**
 * Lock interface for distributed locking.
 *
 * Implementations can be:
 * - In-memory (single instance, for testing or single-server deployments)
 * - Redis-based (distributed across multiple instances)
 * - Database-based (DynamoDB, MySQL, PostgreSQL, etc.)
 * - External services (etcd, Consul, ZooKeeper)
 *
 * The lock MUST:
 * - Have automatic expiry (TTL-based, so crashed holders don't block forever)
 * - Support renewal (extend lease while still holding)
 * - Only let the owner that holds it renew or release it
 * - Be safe for concurrent calls
 */
export interface GGLock {
    /**
     * Try to acquire the lock. Returns true if acquired, false if a live lock is held (by anyone, including `owner`).
     * MUST be atomic and safe for concurrent calls.
     *
     * @param lockId - Unique identifier for this lock
     * @param owner - Identifies the holder, unique per process (e.g. hostname + pid + random)
     * @param ttlMs - Time-to-live in milliseconds. Lock auto-releases after this.
     * @returns true if lock acquired, false if held
     */
    acquire(lockId: string, owner: string, ttlMs: number): Promise<boolean>;

    /**
     * Renew the lock's TTL. Only succeeds while `owner` still holds the lock.
     * Used for heartbeat - extend lease while processing.
     *
     * @param lockId - The lock to renew
     * @param owner - The holder that acquired it
     * @param ttlMs - New TTL from now
     * @returns true if renewed, false if the lock was lost
     */
    renew(lockId: string, owner: string, ttlMs: number): Promise<boolean>;

    /**
     * Release the lock. A no-op unless `owner` holds it, so a holder whose lease expired
     * can't release a lock someone else has since acquired. Idempotent.
     *
     * @param lockId - The lock to release
     * @param owner - The holder that acquired it
     */
    release(lockId: string, owner: string): Promise<void>;
}
