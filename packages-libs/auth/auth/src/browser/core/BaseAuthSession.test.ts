import {describe, test, expect, vi} from "vitest"
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {GGContextKeySynchronizer, GGHeader} from "@grest-ts/http"
import {GGContext} from "@grest-ts/context"
import {BaseAuthSession, GGAuthRefreshTimeoutError} from "../GGAuthSessionBase"
import {GGAuthSession} from "../GGAuthSession"
import type {
    AuthResult,
    Clock,
    CoreConfig,
    CorePorts,
    CrossTabLock,
    DerivedConfig,
    DerivedMap,
    DerivedTokenResult,
    GGTokenPair,
    Scheduler,
    SharedCache,
    StoredAuth,
    TokenKey,
} from "./types"

// ---- Fakes ----

class FakeClock implements Clock {
    private _now: number
    constructor(now = 1_000_000) { this._now = now }
    now() { return this._now }
    advance(ms: number) { this._now += ms }
}

class FakeLock implements CrossTabLock {
    private tail: Promise<unknown> = Promise.resolve()
    async withLock<T>(_name: string, fn: () => Promise<T>): Promise<T> {
        const result = this.tail.then(() => fn())
        this.tail = result.catch((): void => undefined)
        return result
    }
}

class FakeSharedCache implements SharedCache {
    private value: StoredAuth | undefined = undefined
    private readonly listeners = new Set<(v: StoredAuth | undefined) => void>()
    private activeWriter: ((v: StoredAuth | undefined) => void) | undefined = undefined

    read() { return this.value }

    write(v: StoredAuth | undefined): void {
        this.value = v
        for (const l of this.listeners) {
            if (l !== this.activeWriter) l(v)
        }
    }

    subscribe(cb: (v: StoredAuth | undefined) => void): () => void {
        this.listeners.add(cb)
        return () => this.listeners.delete(cb)
    }
}

class FakeScheduler implements Scheduler {
    private readonly scheduled: Array<{delayMs: number; fn: () => void; cancelled: boolean}> = []
    private readonly wakeListeners = new Set<() => void>()

    schedule(delayMs: number, fn: () => void): () => void {
        const entry = {delayMs, fn, cancelled: false}
        this.scheduled.push(entry)
        return () => { entry.cancelled = true }
    }

    onWake(listener: () => void): () => void {
        this.wakeListeners.add(listener)
        return () => this.wakeListeners.delete(listener)
    }

    fireWake() {
        for (const l of this.wakeListeners) l()
    }

    runDue() {
        for (const entry of this.scheduled.splice(0)) {
            if (!entry.cancelled) entry.fn()
        }
    }
}

class FakeKey implements TokenKey {
    readonly name = "fake"
    private _value: string | undefined = undefined
    set(token: string | undefined) { this._value = token }
    get() { return this._value }
}

// ---- Helpers ----

// Let queued microtasks run so the cross-tab lock body executes (FakeLock defers
// it via .then) and the refresh deadline is actually scheduled before we fire it.
const flushMicrotasks = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

function makeAccess(token: string, expiresAt: number): DerivedTokenResult<unknown> {
    return {access: {token, expiresAt}, data: undefined}
}

function makePair(token: string, expiresAt: number, refreshToken?: string): GGTokenPair {
    return {
        access: {token, expiresAt},
        ...(refreshToken ? {refresh: {token: refreshToken, expiresAt: expiresAt + 604_800_000}} : {}),
    }
}

type TestDerived = {
    org: DerivedConfig<{orgId: string}>
}

interface SessionSetup<D extends DerivedMap = {}> {
    clock: FakeClock
    lock: FakeLock
    cache: FakeSharedCache
    scheduler: FakeScheduler
    slot: FakeKey
    refreshFn: ReturnType<typeof vi.fn>
    session: BaseAuthSession<D>
}

function makeSession<D extends DerivedMap = {}>(overrides: {
    derived?: D
    isFatalRefreshError?: (err: unknown) => boolean
    refreshLeadMs?: number
    clockSkewMs?: number
    clock?: FakeClock
    lock?: FakeLock
    cache?: FakeSharedCache
    scheduler?: FakeScheduler
    slot?: FakeKey
    refreshResult?: AuthResult
    refreshImpl?: () => Promise<AuthResult>
    refreshTimeoutMs?: number
    storage?: "localStorage" | "cookie"
} = {}): SessionSetup<D> {
    const clock = overrides.clock ?? new FakeClock()
    const lock = overrides.lock ?? new FakeLock()
    const cache = overrides.cache ?? new FakeSharedCache()
    const scheduler = overrides.scheduler ?? new FakeScheduler()
    const slot = overrides.slot ?? new FakeKey()
    const defaultRefreshResult: AuthResult = {tokens: makePair("at-root-2", 3_000_000, "rt-2")}
    const refreshFn = overrides.refreshImpl
        ? vi.fn(overrides.refreshImpl)
        : vi.fn().mockResolvedValue(overrides.refreshResult ?? defaultRefreshResult)

    const config: CoreConfig<D> = {
        refresh: refreshFn,
        key: slot,
        derived: overrides.derived ?? ({} as D),
        storage: overrides.storage ?? "localStorage",
        refreshLeadMs: overrides.refreshLeadMs ?? 60_000,
        clockSkewMs: overrides.clockSkewMs ?? 10_000,
        refreshTimeoutMs: overrides.refreshTimeoutMs,
        isFatalRefreshError: overrides.isFatalRefreshError ?? ((e) => e instanceof NOT_AUTHORIZED),
    }
    const ports: CorePorts = {clock, lock, cache, scheduler}
    const session = new BaseAuthSession<D>(config, ports)

    return {clock, lock, cache, scheduler, slot, refreshFn, session}
}

// ---- Tests ----

describe("start() — localStorage", () => {
    test("authenticated, root wire set, cache has refreshToken", () => {
        const {session, slot, cache} = makeSession()
        session.start(makePair("at-root-1", 2_000_000, "rt-1"))

        expect(session.getState().status).toBe("authenticated")
        expect(slot.get()).toBe("at-root-1")
        const cached = cache.read()
        expect(cached?.access.token).toBe("at-root-1")
        expect(cached?.refresh?.token).toBe("rt-1")
    })
})

describe("identity persistence", () => {
    test("start(pair, data) exposes data via getIdentity() and persists it to cache", () => {
        const {session, cache} = makeSession()
        session.start(makePair("at", 2_000_000, "rt"), {userId: "u1", role: "admin"})
        expect(session.getIdentity()).toEqual({userId: "u1", role: "admin"})
        expect(cache.read()?.data).toEqual({userId: "u1", role: "admin"})
    })

    test("a fresh session restores identity from cache via init() — no refresh", async () => {
        const cache = new FakeSharedCache()
        const seed = makeSession({cache})
        seed.session.start(makePair("at", 9_000_000, "rt"), {userId: "u1"})

        const {session, refreshFn} = makeSession({cache})
        await session.init()
        expect(session.getState().status).toBe("authenticated")
        expect(session.getIdentity()).toEqual({userId: "u1"})
        expect(refreshFn).not.toHaveBeenCalled()
    })

    test("refresh re-resolves and re-persists identity", async () => {
        const cache = new FakeSharedCache()
        const {session} = makeSession({
            cache,
            refreshResult: {tokens: makePair("at2", 9_000_000, "rt2"), data: {userId: "u1", role: "member"}},
        })
        session.start(makePair("at1", 500_000, "rt1"), {userId: "u1", role: "admin"})
        await session.ensureFresh()
        expect(session.getIdentity()).toEqual({userId: "u1", role: "member"})
        expect(cache.read()?.data).toEqual({userId: "u1", role: "member"})
    })

    test("logout clears identity", () => {
        const {session} = makeSession()
        session.start(makePair("at", 2_000_000, "rt"), {userId: "u1"})
        session.logout()
        expect(session.getIdentity()).toBeUndefined()
    })
})

describe("ensureFresh()", () => {
    test("no-op when root is fresh beyond lead", async () => {
        const {session, refreshFn} = makeSession()
        session.start(makePair("at-root-1", 2_000_000, "rt-1"))
        await session.ensureFresh()
        expect(refreshFn).not.toHaveBeenCalled()
    })

    test("refreshes when root is within lead window", async () => {
        const clock = new FakeClock(1_950_000)
        const {session, refreshFn} = makeSession({clock})
        session.start(makePair("at-root-1", 2_000_000, "rt-1"))
        await session.ensureFresh()
        expect(refreshFn).toHaveBeenCalledOnce()
    })

    test("refreshes when root is expired", async () => {
        const {session, refreshFn} = makeSession()
        session.start(makePair("at-root-1", 500_000, "rt-1"))
        await session.ensureFresh()
        expect(refreshFn).toHaveBeenCalledOnce()
    })

    test("concurrent ×5 → one refresh call (single-flight)", async () => {
        const {session, refreshFn} = makeSession()
        session.start(makePair("at-root-1", 500_000, "rt-1"))
        await Promise.all([
            session.ensureFresh(), session.ensureFresh(), session.ensureFresh(),
            session.ensureFresh(), session.ensureFresh(),
        ])
        expect(refreshFn).toHaveBeenCalledOnce()
    })
})

describe("refresh failure policy", () => {
    test("transient (non-fatal) error → stays authenticated + degraded, token kept, no logout", async () => {
        const {session, slot, refreshFn} = makeSession()
        session.start(makePair("at-root-1", 500_000, "rt-1"))
        refreshFn.mockRejectedValueOnce(new Error("network blip"))
        const onLogout = vi.fn()
        session.onLogout(onLogout)

        await expect(session.ensureFresh()).rejects.toThrow("network blip")

        const state = session.getState()
        expect(state.status).toBe("authenticated")
        expect(state.degraded).toBe(true)
        expect(state.refreshing).toBe(false)
        expect(slot.get()).toBe("at-root-1")
        expect(onLogout).not.toHaveBeenCalled()
    })

    test("fatal error (NOT_AUTHORIZED) → expired, wire cleared, onLogout fires", async () => {
        const {session, slot, refreshFn} = makeSession()
        session.start(makePair("at-root-1", 500_000, "rt-1"))
        refreshFn.mockRejectedValueOnce(new NOT_AUTHORIZED())
        const onLogout = vi.fn()
        session.onLogout(onLogout)

        await expect(session.ensureFresh()).rejects.toBeInstanceOf(NOT_AUTHORIZED)

        expect(session.getState().status).toBe("expired")
        expect(slot.get()).toBeUndefined()
        expect(onLogout).toHaveBeenCalledOnce()
    })

    test("missing refresh token → expired without calling refresh", async () => {
        const {session, slot, refreshFn} = makeSession()
        session.start(makePair("at-root-1", 500_000))
        const onLogout = vi.fn()
        session.onLogout(onLogout)

        await expect(session.ensureFresh()).rejects.toThrow("No refresh token")

        expect(refreshFn).not.toHaveBeenCalled()
        expect(session.getState().status).toBe("expired")
        expect(slot.get()).toBeUndefined()
        expect(onLogout).toHaveBeenCalledOnce()
    })

    test("a later successful refresh clears the degraded flag", async () => {
        const {session, refreshFn} = makeSession()
        session.start(makePair("at-root-1", 500_000, "rt-1"))
        refreshFn.mockRejectedValueOnce(new Error("network blip"))
        await session.ensureFresh().catch((): void => undefined)
        expect(session.getState().degraded).toBe(true)

        await session.ensureFresh()
        expect(session.getState().status).toBe("authenticated")
        expect(session.getState().degraded).toBe(false)
    })
})

describe("refresh timeout (refreshTimeoutMs)", () => {
    test("a refresh that never settles times out → rejects, stays degraded, no logout", async () => {
        const scheduler = new FakeScheduler()
        const {session} = makeSession({
            scheduler,
            refreshTimeoutMs: 15_000,
            refreshImpl: () => new Promise<AuthResult>(() => {}),  // never settles — server down / sibling tab stuck
        })
        session.start(makePair("at-root-1", 500_000, "rt-1"))  // already stale vs the fake clock
        const onLogout = vi.fn()
        session.onLogout(onLogout)

        const p = session.ensureFresh()
        await flushMicrotasks()  // let the lock body schedule the deadline
        scheduler.runDue()       // fire it

        await expect(p).rejects.toBeInstanceOf(GGAuthRefreshTimeoutError)
        const state = session.getState()
        expect(state.status).toBe("authenticated")
        expect(state.degraded).toBe(true)
        expect(state.refreshing).toBe(false)
        expect(onLogout).not.toHaveBeenCalled()
    })

    test("inflight clears on timeout → a subsequent refresh runs and recovers", async () => {
        const scheduler = new FakeScheduler()
        const {session, refreshFn} = makeSession({
            scheduler,
            refreshTimeoutMs: 15_000,
            refreshImpl: () => new Promise<AuthResult>(() => {}),
        })
        session.start(makePair("at-root-1", 500_000, "rt-1"))

        const first = session.ensureFresh()
        await flushMicrotasks()
        scheduler.runDue()
        await expect(first).rejects.toBeInstanceOf(GGAuthRefreshTimeoutError)

        // Not deduped onto the dead inflight: a fresh attempt runs and settles.
        refreshFn.mockReturnValueOnce(Promise.resolve({tokens: makePair("at-root-2", 3_000_000, "rt-2")}))
        await session.ensureFresh()
        expect(session.getState().status).toBe("authenticated")
        expect(session.getState().degraded).toBe(false)
        expect(refreshFn).toHaveBeenCalledTimes(2)
    })

    test("a refresh that completes before the deadline cancels the timer and succeeds", async () => {
        const scheduler = new FakeScheduler()
        const {session} = makeSession({
            scheduler,
            refreshTimeoutMs: 15_000,
            refreshResult: {tokens: makePair("at-root-2", 3_000_000, "rt-2")},
        })
        session.start(makePair("at-root-1", 500_000, "rt-1"))

        await session.ensureFresh()
        expect(session.getState().status).toBe("authenticated")
        expect(session.getState().degraded).toBe(false)

        // The deadline was cancelled on success — firing due timers rejects nothing.
        scheduler.runDue()
        expect(session.getState().status).toBe("authenticated")
    })
})

describe("onWake → ensureFresh (H2: laptop sleep/resume)", () => {
    test("wake refreshes a stale root that the suspended timer never fired", async () => {
        const scheduler = new FakeScheduler()
        const {session, refreshFn} = makeSession({scheduler})
        session.start(makePair("at-root-1", 500_000, "rt-1"))
        expect(refreshFn).not.toHaveBeenCalled()

        scheduler.fireWake()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()

        expect(refreshFn).toHaveBeenCalledOnce()
    })

    test("wake is a no-op when root is still fresh", async () => {
        const scheduler = new FakeScheduler()
        const {session, refreshFn} = makeSession({scheduler})
        session.start(makePair("at-root-1", 9_000_000, "rt-1"))

        scheduler.fireWake()
        await Promise.resolve()
        await Promise.resolve()

        expect(refreshFn).not.toHaveBeenCalled()
    })
})

describe("cross-tab single-flight via lock + cache re-check", () => {
    test("two sessions sharing lock+cache, both ensureFresh expired root → refresh called once; loser adopts", async () => {
        const clock = new FakeClock()
        const lock = new FakeLock()
        const shared = new FakeSharedCache()

        const slot1 = new FakeKey()
        const slot2 = new FakeKey()

        let resolveRefresh!: (v: AuthResult) => void
        const refreshFn = vi.fn().mockImplementation(
            () => new Promise<AuthResult>(r => { resolveRefresh = r })
        )

        const cfg = (slot: FakeKey): CoreConfig => ({
            refresh: refreshFn,
            key: slot,
            derived: {},
            storage: "localStorage",
            refreshLeadMs: 60_000,
            clockSkewMs: 10_000,
            isFatalRefreshError: (e) => e instanceof NOT_AUTHORIZED,
        })
        const ports1: CorePorts = {clock, lock, cache: shared, scheduler: new FakeScheduler()}
        const ports2: CorePorts = {clock, lock, cache: shared, scheduler: new FakeScheduler()}

        const session1 = new BaseAuthSession(cfg(slot1), ports1)
        const session2 = new BaseAuthSession(cfg(slot2), ports2)

        session1.start(makePair("at-root-1", 500_000, "rt-1"))
        session2.start(makePair("at-root-1", 500_000, "rt-1"))

        const p1 = session1.refreshNow()
        const p2 = session2.refreshNow()

        await Promise.resolve()
        await Promise.resolve()

        resolveRefresh({tokens: makePair("at-new", 3_000_000, "rt-new")})
        await Promise.all([p1, p2])

        expect(refreshFn).toHaveBeenCalledOnce()
        expect(slot1.get()).toBe("at-new")
        expect(slot2.get()).toBe("at-new")
    })
})

describe("cross-tab adopt via cache event", () => {
    test("session A commits → session B adopts via cache event, onRefreshed fires; derived pools untouched", async () => {
        const clock = new FakeClock()
        const lock = new FakeLock()
        const shared = new FakeSharedCache()
        const slot1 = new FakeKey()
        const slot2 = new FakeKey()

        const orgSlot1 = new FakeKey()
        const orgMint1 = vi.fn().mockResolvedValue(makeAccess("org-a-1", 3_000_000))
        const orgSlot2 = new FakeKey()
        const orgMint2 = vi.fn().mockResolvedValue(makeAccess("org-x-1", 3_000_000))

        const mk = (slot: FakeKey, orgSlot: FakeKey, orgMint: ReturnType<typeof vi.fn>, refreshFn: ReturnType<typeof vi.fn>): BaseAuthSession<TestDerived> =>
            new BaseAuthSession<TestDerived>(
                {
                    refresh: refreshFn as any,
                    key: slot,
                    derived: {org: {key: orgSlot, mint: orgMint as any}},
                    storage: "localStorage",
                    refreshLeadMs: 60_000,
                    clockSkewMs: 10_000,
                    isFatalRefreshError: (e) => e instanceof NOT_AUTHORIZED,
                },
                {clock, lock, cache: shared, scheduler: new FakeScheduler()},
            )

        const sessionA = mk(slot1, orgSlot1, orgMint1, vi.fn().mockResolvedValue({tokens: makePair("at-root-2", 3_000_000, "rt-2")}))
        const sessionB = mk(slot2, orgSlot2, orgMint2, vi.fn())

        const onRefreshedB = vi.fn()
        sessionB.onRefreshed(onRefreshedB)

        // B starts with a fresh root so selecting derived doesn't trigger a root refresh
        sessionA.start(makePair("at-root-1", 500_000, "rt-1"))
        sessionB.start(makePair("at-root-1", 2_000_000, "rt-1"))

        // Select org on B before A's root refresh
        await sessionB.derived.org.select({orgId: "x"})
        expect(orgMint2).toHaveBeenCalledOnce()

        // A refreshes root — writes to shared cache, which notifies B
        await sessionA.ensureFresh()

        expect(slot2.get()).toBe("at-root-2")
        expect(onRefreshedB).toHaveBeenCalled()
        // B's org pool is untouched (root refresh does NOT re-mint derived)
        expect(orgMint2).toHaveBeenCalledOnce()
    })
})

describe("derived: switch-back does not re-mint", () => {
    test("select(a), select(b), select(a) again → mint called twice, not three times", async () => {
        const orgSlot = new FakeKey()
        let mintCount = 0
        const mintFn = vi.fn().mockImplementation(async ({orgId}: {orgId: string}) => {
            mintCount++
            return makeAccess(`org-token-${orgId}-${mintCount}`, 3_000_000)
        })

        const {session} = makeSession<TestDerived>({
            derived: {org: {key: orgSlot, mint: mintFn}},
            slot: new FakeKey(),
        })
        session.start(makePair("at-root-1", 2_000_000, "rt-1"))

        await session.derived.org.select({orgId: "a"})
        const tokenA = orgSlot.get()
        await session.derived.org.select({orgId: "b"})
        await session.derived.org.select({orgId: "a"})

        expect(mintFn).toHaveBeenCalledTimes(2)
        expect(orgSlot.get()).toBe(tokenA)
    })
})

describe("per-tab org independence", () => {
    test("two sessions sharing cache; session1 org.select(a), session2 org.select(b) → independent wires; one root refresh", async () => {
        const clock = new FakeClock()
        const lock = new FakeLock()
        const shared = new FakeSharedCache()

        const rootSlot1 = new FakeKey()
        const orgSlot1 = new FakeKey()
        const rootSlot2 = new FakeKey()
        const orgSlot2 = new FakeKey()

        const refreshFn = vi.fn().mockResolvedValue({tokens: makePair("at-root-2", 3_000_000, "rt-2")})
        const mint1 = vi.fn().mockResolvedValue(makeAccess("org-a", 3_000_000))
        const mint2 = vi.fn().mockResolvedValue(makeAccess("org-b", 3_000_000))

        const mk = (rootSlot: FakeKey, orgSlot: FakeKey, mint: ReturnType<typeof vi.fn>): BaseAuthSession<TestDerived> =>
            new BaseAuthSession<TestDerived>(
                {
                    refresh: refreshFn as any,
                    key: rootSlot,
                    derived: {org: {key: orgSlot, mint: mint as any}},
                    storage: "localStorage",
                    refreshLeadMs: 60_000,
                    clockSkewMs: 10_000,
                    isFatalRefreshError: (e) => e instanceof NOT_AUTHORIZED,
                },
                {clock, lock, cache: shared, scheduler: new FakeScheduler()},
            )

        const s1 = mk(rootSlot1, orgSlot1, mint1)
        const s2 = mk(rootSlot2, orgSlot2, mint2)

        s1.start(makePair("at-root-1", 500_000, "rt-1"))
        s2.start(makePair("at-root-1", 500_000, "rt-1"))

        await s1.derived.org.select({orgId: "a"})
        await s2.derived.org.select({orgId: "b"})

        expect(orgSlot1.get()).toBe("org-a")
        expect(orgSlot2.get()).toBe("org-b")
        expect(refreshFn).toHaveBeenCalledOnce()
    })
})

describe("root refresh does NOT re-mint fresh pooled derived", () => {
    test("root refresh completes; mint call count unchanged for fresh derived", async () => {
        const orgSlot = new FakeKey()
        const mintFn = vi.fn().mockResolvedValue(makeAccess("org-token-1", 3_000_000))
        const {session, refreshFn} = makeSession<TestDerived>({
            derived: {org: {key: orgSlot, mint: mintFn}},
        })
        session.start(makePair("at-root-1", 500_000, "rt-1"))
        await session.derived.org.select({orgId: "org-1"})
        expect(mintFn).toHaveBeenCalledOnce()

        // Trigger root refresh
        await session.ensureFresh()
        expect(refreshFn).toHaveBeenCalledOnce()

        // mint still called only once — root refresh does NOT re-mint derived
        expect(mintFn).toHaveBeenCalledOnce()
    })
})

describe("logout()", () => {
    test("logout clears cache + wires, fires onLogout", () => {
        const {session, slot, cache} = makeSession()
        session.start(makePair("at-root-1", 2_000_000, "rt-1"))
        const onLogout = vi.fn()
        session.onLogout(onLogout)

        session.logout()

        expect(session.getState().status).toBe("anonymous")
        expect(slot.get()).toBeUndefined()
        expect(cache.read()).toBeUndefined()
        expect(onLogout).toHaveBeenCalledOnce()
    })

    test("cross-tab logout: session B sees cache write(undefined) → logs out", () => {
        const clock = new FakeClock()
        const lock = new FakeLock()
        const shared = new FakeSharedCache()
        const slot1 = new FakeKey()
        const slot2 = new FakeKey()

        const mkSess = (slot: FakeKey) => new BaseAuthSession(
            {
                refresh: vi.fn(),
                key: slot,
                derived: {},
                storage: "localStorage",
                refreshLeadMs: 60_000,
                clockSkewMs: 10_000,
                isFatalRefreshError: (e) => e instanceof NOT_AUTHORIZED,
            },
            {clock, lock, cache: shared, scheduler: new FakeScheduler()},
        )

        const sessionA = mkSess(slot1)
        const sessionB = mkSess(slot2)

        const onLogoutB = vi.fn()
        sessionB.onLogout(onLogoutB)

        sessionA.start(makePair("at-root-1", 2_000_000, "rt-1"))
        sessionB.start(makePair("at-root-1", 2_000_000, "rt-1"))

        sessionA.logout()

        expect(onLogoutB).toHaveBeenCalled()
        expect(slot2.get()).toBeUndefined()
    })
})

describe("cookie mode", () => {
    test("refresh receives undefined; returned refreshToken is ignored (no refreshToken in cache)", async () => {
        const {session, cache} = makeSession({storage: "cookie"})
        session.start(makePair("at-1", 3_000_000, "rt-server"))

        const cached = cache.read()
        expect(cached?.refresh?.token).toBeUndefined()
        expect(cached?.access.token).toBe("at-1")
    })

    test("cookie mode init with no cache → calls refresh with undefined", async () => {
        const refreshFn = vi.fn().mockResolvedValue({tokens: makePair("at-new", 3_000_000)})
        const clock = new FakeClock()
        const cache = new FakeSharedCache()
        const session = new BaseAuthSession(
            {
                refresh: refreshFn,
                key: new FakeKey(),
                derived: {},
                storage: "cookie",
                refreshLeadMs: 60_000,
                clockSkewMs: 10_000,
                isFatalRefreshError: (e) => e instanceof NOT_AUTHORIZED,
            },
            {clock, lock: new FakeLock(), cache, scheduler: new FakeScheduler()},
        )
        await session.init()
        expect(refreshFn).toHaveBeenCalledWith(undefined)
        expect(session.getState().status).toBe("authenticated")
    })

    test("cookie mode: config.logout called on logout()", () => {
        const logoutFn = vi.fn().mockResolvedValue(undefined)
        const session = new BaseAuthSession(
            {
                refresh: vi.fn(),
                key: new FakeKey(),
                derived: {},
                storage: "cookie",
                logout: logoutFn,
                refreshLeadMs: 60_000,
                clockSkewMs: 10_000,
                isFatalRefreshError: (e) => e instanceof NOT_AUTHORIZED,
            },
            {clock: new FakeClock(), lock: new FakeLock(), cache: new FakeSharedCache(), scheduler: new FakeScheduler()},
        )
        session.start(makePair("at-1", 3_000_000))
        session.logout()
        expect(logoutFn).toHaveBeenCalled()
    })
})

describe("type-level: derived handles are correctly typed", () => {
    test("DerivedToken is instantiable", () => {
        const {session} = makeSession<TestDerived>({
            derived: {org: {key: new FakeKey(), mint: async ({orgId}: {orgId: string}) => makeAccess(orgId, 0)}},
        })
        session.start(makePair("at-root-1", 2_000_000, "rt-1"))

        // @ts-expect-error — wrong params shape
        void session.derived.org.select({wrong: 1})

        // @ts-expect-error — key does not exist on derived
        void session.derived.nope
    })
})

describe("isRootStale()", () => {
    test("returns true when no shared tokens yet", () => {
        const {session} = makeSession()
        expect(session.isRootStale()).toBe(true)
    })

    test("returns false when root is fresh", () => {
        const {session} = makeSession()
        session.start(makePair("at-root-1", 2_000_000, "rt-1"))
        expect(session.isRootStale()).toBe(false)
    })

    test("returns true when root expires within clockSkewMs", () => {
        const clock = new FakeClock(1_990_001)
        const {session} = makeSession({clock, clockSkewMs: 10_000})
        session.start(makePair("at-root-1", 2_000_000, "rt-1"))
        expect(session.isRootStale()).toBe(true)
    })

    test("returns true after logout", () => {
        const {session} = makeSession()
        session.start(makePair("at-root-1", 2_000_000, "rt-1"))
        session.logout()
        expect(session.isRootStale()).toBe(true)
    })
})

describe("isDerivedStale()", () => {
    test("returns false when no active selection", () => {
        const orgSlot = new FakeKey()
        const {session} = makeSession<TestDerived>({
            derived: {org: {key: orgSlot, mint: async () => makeAccess("t", 3_000_000)}},
        })
        session.start(makePair("at-root-1", 2_000_000, "rt-1"))
        expect(session.isDerivedStale("org")).toBe(false)
    })

    test("returns false when active derived is fresh", async () => {
        const orgSlot = new FakeKey()
        const {session} = makeSession<TestDerived>({
            derived: {org: {key: orgSlot, mint: async () => makeAccess("fresh-token", 3_000_000)}},
        })
        session.start(makePair("at-root-1", 2_000_000, "rt-1"))
        await session.derived.org.select({orgId: "a"})
        expect(session.isDerivedStale("org")).toBe(false)
    })

    test("returns true when active derived is expired", async () => {
        const clock = new FakeClock(1_000_000)
        const orgSlot = new FakeKey()
        const {session} = makeSession<TestDerived>({
            clock,
            clockSkewMs: 10_000,
            derived: {org: {key: orgSlot, mint: async () => makeAccess("stale-token", 500_000)}},
        })
        session.start(makePair("at-root-1", 2_000_000, "rt-1"))
        await session.derived.org.select({orgId: "a"})
        expect(session.isDerivedStale("org")).toBe(true)
    })
})

describe("ensureActiveDerivedFresh()", () => {
    test("no-op when no active selection", async () => {
        const orgSlot = new FakeKey()
        const mintFn = vi.fn().mockResolvedValue(makeAccess("t", 3_000_000))
        const {session} = makeSession<TestDerived>({
            derived: {org: {key: orgSlot, mint: mintFn}},
        })
        session.start(makePair("at-root-1", 2_000_000, "rt-1"))
        await session.ensureActiveDerivedFresh("org")
        expect(mintFn).not.toHaveBeenCalled()
    })

    test("no-op when active derived is fresh", async () => {
        const orgSlot = new FakeKey()
        const mintFn = vi.fn().mockResolvedValue(makeAccess("fresh-token", 3_000_000))
        const {session} = makeSession<TestDerived>({
            derived: {org: {key: orgSlot, mint: mintFn}},
        })
        session.start(makePair("at-root-1", 2_000_000, "rt-1"))
        await session.derived.org.select({orgId: "a"})
        mintFn.mockClear()
        await session.ensureActiveDerivedFresh("org")
        expect(mintFn).not.toHaveBeenCalled()
    })

    test("re-mints once when active derived is stale", async () => {
        const clock = new FakeClock(1_000_000)
        const orgSlot = new FakeKey()
        let mintCount = 0
        const mintFn = vi.fn().mockImplementation(async () => {
            mintCount++
            return mintCount === 1
                ? makeAccess("stale-token", 500_000)
                : makeAccess("fresh-token", 3_000_000)
        })
        const {session} = makeSession<TestDerived>({
            clock,
            clockSkewMs: 10_000,
            derived: {org: {key: orgSlot, mint: mintFn}},
        })
        session.start(makePair("at-root-1", 2_000_000, "rt-1"))
        await session.derived.org.select({orgId: "a"})
        expect(orgSlot.get()).toBe("stale-token")

        await session.ensureActiveDerivedFresh("org")

        expect(mintFn).toHaveBeenCalledTimes(2)
        expect(orgSlot.get()).toBe("fresh-token")
    })

    test("concurrent calls are single-flighted", async () => {
        const clock = new FakeClock(1_000_000)
        const orgSlot = new FakeKey()
        let mintCount = 0
        const mintFn = vi.fn().mockImplementation(async () => {
            mintCount++
            return mintCount === 1
                ? makeAccess("stale-token", 500_000)
                : makeAccess("fresh-token", 3_000_000)
        })
        const {session} = makeSession<TestDerived>({
            clock,
            clockSkewMs: 10_000,
            derived: {org: {key: orgSlot, mint: mintFn}},
        })
        session.start(makePair("at-root-1", 2_000_000, "rt-1"))
        await session.derived.org.select({orgId: "a"})

        await Promise.all([
            session.ensureActiveDerivedFresh("org"),
            session.ensureActiveDerivedFresh("org"),
            session.ensureActiveDerivedFresh("org"),
        ])

        expect(mintFn).toHaveBeenCalledTimes(2)
    })
})

describe("AuthSession — GGContextKeySynchronizer.provide wiring", () => {
    // The session schedules a proactive refresh on start(); fake timers keep that scheduled
    // callback from firing after the test (which would hit the mock refresh + unstubbed globals).
    const okPair = () => makePair("at2", 9_999_999_999, "rt2")
    const okDerived = () => ({access: {token: "org-tok", expiresAt: 9_999_999_999}, data: {}})

    test("constructing AuthSession with root + one derived calls provide twice", () => {
        const provideSpy = vi.spyOn(GGContextKeySynchronizer, "provide").mockImplementation(() => undefined)

        vi.useFakeTimers()
        vi.stubGlobal("localStorage", {getItem: vi.fn().mockReturnValue(null), setItem: vi.fn(), removeItem: vi.fn()})
        vi.stubGlobal("window", {addEventListener: vi.fn(), removeEventListener: vi.fn()})
        vi.stubGlobal("document", {addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: "visible"})

        try {
            const rootWire = new GGHeader("authorization-t1", {scheme: "bearer"})
            const orgWire = new GGHeader("x-org-t1", {})

            new GGContext("test").run(() => {
                GGAuthSession.withToken(rootWire, {refresh: vi.fn().mockResolvedValue({tokens: okPair()}), localStorageKey: "test"})
                    .addDerived("org", orgWire, {mint: vi.fn().mockResolvedValue(okDerived())})
                    .start({tokens: makePair("at", 0, "rt")}) // triggers _getSession

                expect(provideSpy).toHaveBeenCalledTimes(2)

                const [firstCall, secondCall] = provideSpy.mock.calls
                expect(firstCall[0]).toBe(rootWire)
                expect(typeof firstCall[1].isStale).toBe("function")
                expect(typeof firstCall[1].recover).toBe("function")
                expect(secondCall[0]).toBe(orgWire)
                expect(typeof secondCall[1].isStale).toBe("function")
                expect(typeof secondCall[1].recover).toBe("function")
            })
        } finally {
            provideSpy.mockRestore()
            vi.useRealTimers()
            vi.unstubAllGlobals()
        }
    })

    test("constructing AuthSession with no derived calls provide once", () => {
        const provideSpy = vi.spyOn(GGContextKeySynchronizer, "provide").mockImplementation(() => undefined)

        vi.useFakeTimers()
        vi.stubGlobal("localStorage", {getItem: vi.fn().mockReturnValue(null), setItem: vi.fn(), removeItem: vi.fn()})
        vi.stubGlobal("window", {addEventListener: vi.fn(), removeEventListener: vi.fn()})
        vi.stubGlobal("document", {addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: "visible"})

        try {
            const rootWire = new GGHeader("authorization-t2", {scheme: "bearer"})
            new GGContext("test").run(() => {
                GGAuthSession.withToken(rootWire, {refresh: vi.fn().mockResolvedValue({tokens: okPair()}), localStorageKey: "test"})
                    .start({tokens: makePair("at", 0, "rt")}) // triggers _getSession
                expect(provideSpy).toHaveBeenCalledTimes(1)
            })
        } finally {
            provideSpy.mockRestore()
            vi.useRealTimers()
            vi.unstubAllGlobals()
        }
    })

    test("isStale controller reflects session state correctly", async () => {
        const capturedControllers: Array<{isStale: () => boolean; recover: () => Promise<void>}> = []
        const provideSpy = vi.spyOn(GGContextKeySynchronizer, "provide").mockImplementation((_key, ctrl) => {
            capturedControllers.push(ctrl)
        })

        vi.useFakeTimers()
        vi.stubGlobal("localStorage", {getItem: vi.fn().mockReturnValue(null), setItem: vi.fn(), removeItem: vi.fn()})
        vi.stubGlobal("window", {addEventListener: vi.fn(), removeEventListener: vi.fn()})
        vi.stubGlobal("document", {addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: "visible"})

        try {
            const rootWire = new GGHeader("authorization-t3", {scheme: "bearer"})
            const orgWire = new GGHeader("x-org-t3", {})

            await new GGContext("test").run(async () => {
                GGAuthSession.withToken(rootWire, {refresh: vi.fn().mockResolvedValue({tokens: okPair()}), localStorageKey: "test"})
                    .addDerived("org", orgWire, {mint: vi.fn().mockResolvedValue(okDerived())})
                    .start({tokens: makePair("at", 0, "rt")}) // triggers _getSession

                const rootCtrl = capturedControllers[0]
                const orgCtrl = capturedControllers[1]

                // root token expiresAt=0 is stale; derived has no active selection → not stale
                expect(rootCtrl.isStale()).toBe(true)
                expect(orgCtrl.isStale()).toBe(false)

                expect(typeof rootCtrl.recover).toBe("function")
                const rec = rootCtrl.recover()
                expect(rec).toBeInstanceOf(Promise)
                // Drain the refresh before unstubbing globals so its tail doesn't reject unhandled.
                await rec
            })
        } finally {
            provideSpy.mockRestore()
            vi.useRealTimers()
            vi.unstubAllGlobals()
        }
    })
})
