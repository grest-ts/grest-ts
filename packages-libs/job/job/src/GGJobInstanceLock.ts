import type {GGJobLock} from "./GGJobLock"

interface Entry {
    owner?: string
    lockedUntil?: number
    lastRunAt?: number
}

/** Single process only: local dev, tests, single-instance deployments. */
export class GGJobInstanceLock implements GGJobLock {

    private readonly entries = new Map<string, Entry>()

    async acquire(id: string, owner: string, ttlMs: number, lastRunAtMost?: number): Promise<boolean> {
        const now = Date.now()
        const e = this.entries.get(id) ?? {}
        if (e.lockedUntil !== undefined && e.lockedUntil >= now) return false
        if (lastRunAtMost !== undefined && e.lastRunAt !== undefined && e.lastRunAt > lastRunAtMost) return false
        this.entries.set(id, {...e, owner, lockedUntil: now + ttlMs})
        return true
    }

    async renew(id: string, owner: string, ttlMs: number): Promise<boolean> {
        const e = this.entries.get(id)
        if (!e || e.owner !== owner) return false
        e.lockedUntil = Date.now() + ttlMs
        return true
    }

    async release(id: string, owner: string, ranAt?: number): Promise<void> {
        const e = this.entries.get(id)
        if (!e || e.owner !== owner) return
        if (ranAt === undefined) this.entries.delete(id)
        else this.entries.set(id, {lastRunAt: ranAt})
    }
}
