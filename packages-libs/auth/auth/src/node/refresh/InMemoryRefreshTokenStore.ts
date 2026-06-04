import {IsRefreshTokenRecord, type RefreshTokenRecord, type RefreshTokenStore} from "./RefreshTokenStore"

/** Process-local store. Suitable for tests and single-instance/simple apps. */
export class InMemoryRefreshTokenStore implements RefreshTokenStore {

    private readonly records = new Map<string, RefreshTokenRecord>()
    private readonly now: () => number
    constructor(now: () => number = Date.now) {
        this.now = now
    }

    public save = async (record: RefreshTokenRecord): Promise<void> => {
        this.sweepExpired()
        this.records.set(record.tokenHash, record)
    }

    public find = async (tokenHash: string): Promise<RefreshTokenRecord | undefined> => {
        return this.records.get(tokenHash)
    }

    public markSpent = async (tokenHash: string, spentAt: number): Promise<boolean> => {
        const record = this.records.get(tokenHash)
        if (!record || record.spentAt !== undefined) return false
        this.records.set(tokenHash, IsRefreshTokenRecord.parse({...record, spentAt}))
        return true
    }

    public revoke = async (tokenHash: string): Promise<void> => {
        this.records.delete(tokenHash)
    }

    public revokeFamily = async (familyId: string): Promise<void> => {
        for (const [hash, record] of this.records) {
            if (record.familyId === familyId) this.records.delete(hash)
        }
    }

    public revokeForSubject = async (subject: string): Promise<void> => {
        for (const [hash, record] of this.records) {
            if (record.subject === subject) this.records.delete(hash)
        }
    }

    // Drop expired records on write so a store whose tokens are mostly left to expire
    // (never redeemed) can't grow without bound. O(n) per save — fine at the
    // single-instance/simple-app scale this store targets.
    private sweepExpired(): void {
        const now = this.now()
        for (const [hash, record] of this.records) {
            if (record.expiresAt <= now) this.records.delete(hash)
        }
    }
}
