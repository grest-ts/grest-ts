import {GGLock} from "../GGLock";
import {GGLocator, GGLocatorKey} from "@grest-ts/locator";

export const GGContextLockStorageKey = new GGLocatorKey<Map<string, LockEntry>>("GGLocatorScopeLock");

interface LockEntry {
    owner: string;
    expiresAt: number;
}

/**
 * Async context-scoped lock implementation.
 *
 * This lock is scoped to the current GGLocator async context (GGLocatorScope).
 * Different contexts have completely isolated lock states.
 *
 * Use this for:
 * - Ensuring operations within a request/context are serialized
 * - Preventing concurrent access to resources within the same context
 * - Testing scenarios where you need isolated lock state per test
 *
 * The lock automatically uses the current GGLocatorScope from GGLocator.getScope().
 * If no scope exists, operations will throw an error.
 *
 * @example
 * ```typescript
 * const lock = new GGContextLock();
 *
 * if (await lock.acquire('my-task', owner, 30000)) {
 *   try {
 *     // Do work while holding the lock
 *   } finally {
 *     await lock.release('my-task', owner);
 *   }
 * }
 * ```
 */
export class GGLocatorScopeLock implements GGLock {

    private getStorage(): Map<string, LockEntry> {
        const scope = GGLocator.getScope();
        const existing = scope.tryGet(GGContextLockStorageKey);
        if (existing) {
            return existing;
        }
        // Auto-register storage if not present
        const storage = new Map<string, LockEntry>();
        scope.set(GGContextLockStorageKey, storage);
        return storage;
    }

    async acquire(lockId: string, owner: string, ttlMs: number): Promise<boolean> {
        const storage = this.getStorage();
        const now = Date.now();

        // Clean up expired lock
        const existing = storage.get(lockId);
        if (existing && existing.expiresAt <= now) {
            storage.delete(lockId);
        }

        // Check if lock is held
        if (storage.has(lockId)) {
            return false;
        }

        // Acquire the lock
        storage.set(lockId, {
            owner,
            expiresAt: now + ttlMs
        });

        return true;
    }

    async renew(lockId: string, owner: string, ttlMs: number): Promise<boolean> {
        const storage = this.getStorage();
        const now = Date.now();

        const existing = storage.get(lockId);

        if (!existing || existing.owner !== owner || existing.expiresAt <= now) {
            return false;
        }

        // Extend the TTL
        existing.expiresAt = now + ttlMs;
        return true;
    }

    async release(lockId: string, owner: string): Promise<void> {
        const storage = this.getStorage();
        if (storage.get(lockId)?.owner === owner) {
            storage.delete(lockId);
        }
    }
}
