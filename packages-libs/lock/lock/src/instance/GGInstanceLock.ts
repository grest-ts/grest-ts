import {GGLock} from "../GGLock";

interface LockEntry {
    expiresAt: number;
}

/**
 * In-memory lock implementation for single-instance deployments.
 *
 * This lock is NOT distributed - it only works within a single process.
 * Use this for:
 * - Single-server deployments where you only have one instance
 * - Development and testing environments
 * - Scenarios where you need lock semantics but not distribution
 *
 * For distributed locking across multiple instances, use a Redis or
 * database-backed implementation instead.
 *
 * @example
 * ```typescript
 * const lock = new GGInstanceLock();
 *
 * if (await lock.acquire('my-task', 30000)) {
 *   try {
 *     // Do work while holding the lock
 *   } finally {
 *     await lock.release('my-task');
 *   }
 * }
 * ```
 */
export class GGInstanceLock implements GGLock {
    private readonly locks = new Map<string, LockEntry>();

    async acquire(lockId: string, ttlMs: number): Promise<boolean> {
        const now = Date.now();

        // Clean up expired lock
        const existing = this.locks.get(lockId);
        if (existing && existing.expiresAt <= now) {
            this.locks.delete(lockId);
        }

        // Check if lock is held
        if (this.locks.has(lockId)) {
            return false;
        }

        // Acquire the lock
        this.locks.set(lockId, {
            expiresAt: now + ttlMs
        });

        return true;
    }

    async renew(lockId: string, ttlMs: number): Promise<boolean> {
        const now = Date.now();

        const existing = this.locks.get(lockId);

        // Can only renew if lock exists and hasn't expired
        if (!existing || existing.expiresAt <= now) {
            return false;
        }

        // Extend the TTL
        existing.expiresAt = now + ttlMs;
        return true;
    }

    async release(lockId: string): Promise<void> {
        this.locks.delete(lockId);
    }
}
