/**
 * A lease lock. A lease lasts until acquire/renew time + `ttlMs` and has expired from that instant on.
 * Every call must be atomic; only the owner holding an unexpired lease may renew it, and release is a no-op for anyone
 * else, so a holder whose lease expired can't free a lock someone has since acquired.
 */
export interface GGLock {
    /** False while any unexpired lease is held, including `owner`'s own. */
    acquire(lockId: string, owner: string, ttlMs: number): Promise<boolean>;
    /** False when `owner` no longer holds the lease: the lock is lost. */
    renew(lockId: string, owner: string, ttlMs: number): Promise<boolean>;
    release(lockId: string, owner: string): Promise<void>;
}
