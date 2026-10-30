import {hostname} from "node:os";
import {randomUUID} from "node:crypto";
import {GGLocator} from "@grest-ts/locator";
import {GGLog} from "@grest-ts/logger";
import type {GGLock} from "./GGLock";

export interface GGWithLockOptions {
    /** Default: a fresh `newLockOwner()` for this call. */
    owner?: string;
    ttlMs: number;
    /** Aborts `fn`'s signal too. A run it aborted is released without `holdUntil`. */
    signal?: AbortSignal;
    /**
     * Epoch ms. When `fn` completes without throwing or being aborted, the lease is renewed to last until then instead
     * of released, so nobody (this owner included) acquires the lock before: a cooldown.
     */
    holdUntil?: number;
}

/**
 * `DONE`: `fn` returned, also after the caller's own `signal` aborted it. `BUSY`: someone holds the lock, `fn` never
 * ran. `LOST`: `fn` ran but the lock was lost mid-way.
 */
export type GGWithLockResult = "DONE" | "BUSY" | "LOST";

/** Unique per process: hostname, pid and a random suffix. */
export function newLockOwner(): string {
    return `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
}



/**
 * Runs `fn` while holding `lockId`, renewing it every `ttlMs / 3`. The lock is lost when a renew fails, or when the
 * last renew that succeeded was sent two thirds of a TTL ago; `fn`'s signal is then aborted, and the lock is not
 * released (someone else may hold it). `fn` must stop at the signal for the lock to mean anything.
 */
export async function withLock(
    lock: GGLock,
    lockId: string,
    options: GGWithLockOptions,
    fn: (signal: AbortSignal) => Promise<void>,
): Promise<GGWithLockResult> {
    const {ttlMs, signal, holdUntil} = options;
    const owner = options.owner ?? newLockOwner();
    // Inside a runtime, timers belong to its scope (stopped with it); outside one, plain timers.
    const scope = GGLocator.tryGetScope();
    const every = (fn: () => void, ms: number) => (scope ? scope.setInterval(fn, ms) : setInterval(fn, ms)).unref();
    const after = (fn: () => void, ms: number) => (scope ? scope.setTimeout(fn, ms) : setTimeout(fn, ms)).unref();
    let renewedAt = Date.now();
    if (!await lock.acquire(lockId, owner, ttlMs)) return "BUSY";
    const lost = new AbortController();
    let done = false;
    const lose = () => {
        if (done || lost.signal.aborted) return;
        GGLog.warn(lock, "Lost lock, aborting", {lockId, owner});
        lost.abort();
        clearInterval(heartbeat);
    };
    // One renew at a time, so the hold below has only one to wait for.
    let renewing: Promise<void> | undefined;
    const heartbeat = every(() => {
        const sentAt = Date.now();
        if (sentAt - renewedAt >= ttlMs * 2 / 3) return lose();
        if (renewing) return;
        renewing = lock.renew(lockId, owner, ttlMs).then(ok => {
            if (ok) renewedAt = sentAt;
            else lose();
        }, err => GGLog.warn(lock, "Lock renew failed", {lockId, owner, err: (err as Error).message}))
            .finally(() => { renewing = undefined; });
    }, ttlMs / 3);
    let completed = false;
    try {
        await fn(signal ? AbortSignal.any([signal, lost.signal]) : lost.signal);
        completed = !signal?.aborted;
    } finally {
        clearInterval(heartbeat);
        const hold = completed && holdUntil !== undefined && holdUntil > Date.now();
        if (hold && renewing) {
            // A renew still in flight would otherwise land after the hold and shorten it. Past a TTL the lease is gone.
            let timer: NodeJS.Timeout | undefined;
            await Promise.race([renewing, new Promise<void>(r => { timer = after(r, ttlMs); })]);
            clearTimeout(timer);
        }
        done = true;
        if (!lost.signal.aborted) {
            const holdMs = hold ? holdUntil! - Date.now() : 0;
            if (holdMs > 0) {
                await lock.renew(lockId, owner, holdMs).then(
                    ok => { if (!ok) GGLog.warn(lock, "Lock hold failed: the lease was already lost", {lockId, owner}); },
                    err => GGLog.warn(lock, "Lock hold failed", {lockId, owner, err: (err as Error).message}),
                );
            } else {
                await lock.release(lockId, owner)
                    .catch(err => GGLog.warn(lock, "Lock release failed", {lockId, owner, err: (err as Error).message}));
            }
        }
    }
    return lost.signal.aborted ? "LOST" : "DONE";
}
