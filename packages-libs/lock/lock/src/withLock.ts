import {hostname} from "node:os";
import {randomUUID} from "node:crypto";
import {GGLocator} from "@grest-ts/locator";
import {GGLog} from "@grest-ts/logger";
import type {GGLock} from "./GGLock";

export interface GGWithLockOptions {
    owner: string;
    ttlMs: number;
    /** Aborts `fn`'s signal too. A run it aborted is released without `holdUntil`. */
    signal?: AbortSignal;
    /** When `fn` completes without throwing or being aborted, the lock stays taken until this time (epoch ms). */
    holdUntil?: number;
}

/** `BUSY`: someone holds the lock, `fn` never ran. `LOST`: `fn` ran but the lock was lost mid-way. */
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
    const {owner, ttlMs, signal, holdUntil} = options;
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
    const heartbeat = GGLocator.getScope().setInterval(() => {
        const sentAt = Date.now();
        if (sentAt - renewedAt >= ttlMs * 2 / 3) return lose();
        lock.renew(lockId, owner, ttlMs).then(ok => {
            if (ok) renewedAt = Math.max(renewedAt, sentAt);
            else lose();
        }, err => GGLog.warn(lock, "Lock renew failed", {lockId, owner, err: (err as Error).message}));
    }, ttlMs / 3);
    heartbeat.unref();
    let completed = false;
    try {
        await fn(signal ? AbortSignal.any([signal, lost.signal]) : lost.signal);
        completed = !signal?.aborted;
    } finally {
        done = true;
        clearInterval(heartbeat);
        if (!lost.signal.aborted) {
            await lock.release(lockId, owner, completed ? {until: holdUntil} : undefined)
                .catch(err => GGLog.warn(lock, "Lock release failed", {lockId, owner, err: (err as Error).message}));
        }
    }
    return lost.signal.aborted ? "LOST" : "DONE";
}
