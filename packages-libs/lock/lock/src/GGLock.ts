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
 * - Have automatic expiry (TTL-based, so crashed holders don't block forever). A lease is held until
 *   acquire/renew time + ttlMs; from that instant on it has expired, whether or not anyone acquired it since.
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
     * Renew the lock's TTL. Only succeeds while `owner` holds an unexpired lease.
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
     * @param options - `until` keeps the lock taken, by no owner, until that time
     */
    release(lockId: string, owner: string, options?: GGLockReleaseOptions): Promise<void>;
}

export interface GGLockReleaseOptions {
    /**
     * Epoch ms. The lock stays taken, by no owner, until then: nobody can acquire it before. A cooldown, e.g. a job
     * that must not run again before its next interval. In the past or omitted, the lock is free straight away.
     */
    until?: number;
}
