import type {GGJobLock} from "./GGJobLock"

interface Entry {
    owner?: string
    lockedUntil?: number
    lastRunAt?: number
}

/** Single process only: local dev, tests, single-instance deployments. */
export class GGJobInstanceLock implements GGJobLock {

    private readonly entries = new Map<string, Entry>()
    private readonly now: () => number

    constructor(now: () => number = Date.now) {
        this.now = now
    }

    async acquire(id: string, owner: string, ttlMs: number, lastRunAtMost?: number): Promise<boolean> {
        const now = this.now()
        const e = this.entries.get(id) ?? {}
        if (e.lockedUntil !== undefined && e.lockedUntil >= now) return false
        if (lastRunAtMost !== undefined && e.lastRunAt !== undefined && e.lastRunAt > lastRunAtMost) return false
        this.entries.set(id, {...e, owner, lockedUntil: now + ttlMs})
        return true
    }

    async renew(id: string, owner: string, ttlMs: number): Promise<boolean> {
        const e = this.entries.get(id)
        if (!e || e.owner !== owner) return false
        e.lockedUntil = this.now() + ttlMs
        return true
    }

    async release(id: string, owner: string, ranAt?: number): Promise<void> {
        const e = this.entries.get(id)
        if (!e || e.owner !== owner) return
        if (ranAt === undefined) this.entries.delete(id)
        else this.entries.set(id, {lastRunAt: ranAt})
    }
}
