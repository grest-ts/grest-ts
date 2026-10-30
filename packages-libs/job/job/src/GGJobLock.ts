import type {GGLock} from "@grest-ts/lock"

/** A `GGLock` that also records when an `exclusive` job last ran, so it runs once per interval across instances. */
export interface GGJobLock extends GGLock {
    /** With `lastRunAtMost`, only when the recorded last run started at or before that time. */
    acquire(id: string, owner: string, ttlMs: number, lastRunAtMost?: number): Promise<boolean>
    /** With `ranAt`, records it as the last run; without, the lock is dropped entirely. */
    release(id: string, owner: string, ranAt?: number): Promise<void>
}
