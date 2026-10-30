import {GGLock} from "../GGLock";

export interface GGInstanceLockEntry {
    owner: string;
    expiresAt: number;
}

/**
 * In-memory lock for one process: single-instance deployments, development and tests.
 * With several instances it excludes nothing; use a shared store (e.g. `@grest-ts/lock-dynamodb`).
 *
 * @example
 * ```typescript
 * // inside a GGLocatorScope, e.g. runtime code
 * const lock = new GGInstanceLock();
 * await withLock(lock, 'my-task', {owner: newLockOwner(), ttlMs: 30000}, async signal => {
 *     // Do work while holding the lock
 * });
 * ```
 */
export class GGInstanceLock implements GGLock {
    private locks?: Map<string, GGInstanceLockEntry>;

    protected storage(): Map<string, GGInstanceLockEntry> {
        return this.locks ??= new Map();
    }

    async acquire(lockId: string, owner: string, ttlMs: number): Promise<boolean> {
        const storage = this.storage();
        const now = Date.now();
        const existing = storage.get(lockId);
        if (existing && existing.expiresAt > now) {
            return false;
        }
        storage.set(lockId, {owner, expiresAt: now + ttlMs});
        return true;
    }

    async renew(lockId: string, owner: string, ttlMs: number): Promise<boolean> {
        const now = Date.now();
        const existing = this.storage().get(lockId);
        if (!existing || existing.owner !== owner || existing.expiresAt <= now) {
            return false;
        }
        existing.expiresAt = now + ttlMs;
        return true;
    }

    async release(lockId: string, owner: string): Promise<void> {
        const storage = this.storage();
        if (storage.get(lockId)?.owner === owner) {
            storage.delete(lockId);
        }
    }
}
