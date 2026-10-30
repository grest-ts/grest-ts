import type {GGLock} from "../GGLock";

/** One process only: with several instances it excludes nothing. */
export class GGInstanceLock implements GGLock {
    private locks?: Map<string, {owner: string, expiresAt: number}>;

    protected storage(): Map<string, {owner: string, expiresAt: number}> {
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
