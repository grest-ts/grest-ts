import type {
    AuthResult,
    CoreConfig,
    CorePorts,
    DerivedConfig,
    DerivedData,
    DerivedMap,
    DerivedParams,
    DerivedTokenResult,
    GGTokenPair,
    SessionState,
    StoredAuth,
} from "./core/types"

// Thrown when a refresh exceeds CoreConfig.refreshTimeoutMs. Non-fatal by
// design (not a NOT_AUTHORIZED), so the session degrades and retries rather
// than logging out.
export class GGAuthRefreshTimeoutError extends Error {
    constructor(ms: number) {
        super(`auth refresh timed out after ${ms}ms`)
        this.name = "GGAuthRefreshTimeoutError"
    }
}

// Data fields of D proxied as optional properties on the DerivedToken handle.
type ProxiedData<D> = D extends object ? Partial<D> : {}

// Public handle for a derived token slot. Methods drive the lifecycle;
// data properties proxy the current active result's data fields.
export type DerivedToken<P, D = unknown> = {
    select(params: P): Promise<void>
    clear(): void
    get(): D | undefined
} & ProxiedData<D>

function makeDerivedToken<P, D>(
    _select: (params: P) => Promise<void>,
    _clear: () => void,
    _get: () => D | undefined,
): DerivedToken<P, D> {
    const methods = {select: _select, clear: _clear, get: _get}
    return new Proxy(methods as object, {
        get(target, prop) {
            if (prop in target) return (target as Record<string, unknown>)[prop as string]
            return _get()?.[prop as keyof D]
        },
    }) as unknown as DerivedToken<P, D>
}

interface DerivedEntry {
    pool: Map<string, { params: unknown; result: DerivedTokenResult<unknown> }>
    active: string | undefined
}

function stableKey(params: unknown): string {
    if (params === undefined || params === null) return ""
    if (typeof params !== "object") return String(params)
    const sorted = Object.keys(params as object).sort()
    const obj: Record<string, unknown> = {}
    for (const k of sorted) obj[k] = (params as Record<string, unknown>)[k]
    return JSON.stringify(obj)
}

export class BaseAuthSession<D extends DerivedMap> {
    protected readonly config: CoreConfig<D>
    protected readonly ports: CorePorts

    private shared: GGTokenPair | undefined = undefined
    // The identity `data` carried by the auth response, persisted with the tokens so it survives
    // reload + cross-tab. Read via getIdentity(); the session never decodes the access token.
    private identity: unknown = undefined
    private state: SessionState = {status: "anonymous", refreshing: false, degraded: false}
    private inflightRefresh: Promise<void> | null = null
    private readonly inflightDerivedMint = new Map<string, Promise<void>>()
    private cancelScheduled: (() => void) | null = null
    private writing = false

    private readonly stateListeners = new Set<() => void>()
    private readonly refreshedListeners = new Set<() => void>()
    private readonly logoutListeners = new Set<() => void>()

    private readonly derivedState = new Map<string, DerivedEntry>()

    readonly derived: {[K in keyof D]: DerivedToken<DerivedParams<D[K]>, DerivedData<D[K]>>}

    private get derivedCfgMap(): Record<string, DerivedConfig<any, any>> {
        return (this.config.derived ?? {}) as Record<string, DerivedConfig<any, any>>
    }

    constructor(config: CoreConfig<D>, ports: CorePorts) {
        this.config = config
        this.ports = ports

        const derivedMap = config.derived ?? ({} as D)
        const handles = {} as {[K in keyof D]: DerivedToken<DerivedParams<D[K]>, DerivedData<D[K]>>}
        for (const key of Object.keys(derivedMap) as (keyof D & string)[]) {
            this.derivedState.set(key, {pool: new Map(), active: undefined})
            handles[key] = makeDerivedToken(
                (params) => this.selectDerived(key, params),
                () => this.clearDerived(key),
                () => this.getDerived(key) as DerivedData<D[typeof key]> | undefined,
            ) as any
        }
        this.derived = handles

        ports.cache.subscribe((incoming) => this.onCrossTab(incoming))
        ports.scheduler.onWake(() => { void this.ensureFresh().catch(() => {}) })
    }

    subscribe(listener: () => void): () => void {
        this.stateListeners.add(listener)
        return () => this.stateListeners.delete(listener)
    }

    getState(): SessionState {
        return this.state
    }

    onRefreshed(cb: () => void): () => void {
        this.refreshedListeners.add(cb)
        return () => this.refreshedListeners.delete(cb)
    }

    onLogout(cb: () => void): () => void {
        this.logoutListeners.add(cb)
        return () => this.logoutListeners.delete(cb)
    }

    async init(): Promise<void> {
        const cached = this.ports.cache.read()
        const now = this.ports.clock.now()

        if (this.config.storage === "cookie") {
            if (!cached?.access) {
                this.setState({status: "restoring", refreshing: false, degraded: false})
                this.notifyListeners()
                try {
                    await this.refreshNow()
                } catch (e) {
                    if (this.config.isFatalRefreshError(e)) {
                        this.setState({status: "anonymous", refreshing: false, degraded: false})
                        this.notifyListeners()
                    }
                }
                return
            }
            this.adoptRoot(cached)
            this.setState({...this.state, status: "restoring"})
            this.notifyListeners()
            if (cached.access.expiresAt <= now + this.config.clockSkewMs) {
                try {
                    await this.ensureFresh()
                } catch {
                    if (this.state.status !== "expired") {
                        this.setState({status: "authenticated", refreshing: false, degraded: true})
                        this.notifyListeners()
                    }
                }
            } else {
                this.setState({status: "authenticated", refreshing: false, degraded: false})
                this.notifyListeners()
            }
            return
        }

        if (!cached?.access) {
            this.setState({status: "anonymous", refreshing: false, degraded: false})
            this.notifyListeners()
            return
        }

        this.adoptRoot(cached)
        this.setState({...this.state, status: "restoring"})
        this.notifyListeners()

        if (cached.access.expiresAt <= now + this.config.clockSkewMs) {
            try {
                await this.ensureFresh()
            } catch {
                if (this.state.status !== "expired") {
                    this.setState({status: "authenticated", refreshing: false, degraded: true})
                    this.notifyListeners()
                }
            }
        } else {
            this.setState({status: "authenticated", refreshing: false, degraded: false})
            this.notifyListeners()
        }
    }

    start(pair: GGTokenPair, data?: unknown): void {
        this.identity = data
        const next: GGTokenPair = {
            access: pair.access,
            refresh: this.config.storage === "cookie" ? undefined : pair.refresh,
        }
        this.commitShared(next)
    }

    getIdentity(): unknown {
        return this.identity
    }

    logout(): void {
        this.shared = undefined
        this.identity = undefined
        this.clearRootWire()
        this.clearAllDerivedWires()
        this.cacheWrite(undefined)
        this.cancelNextRefresh()
        this.setState({status: "anonymous", refreshing: false, degraded: false})
        this.fireLogout()
        this.notifyListeners()
        if (this.config.storage === "cookie" && this.config.logout) {
            void this.config.logout()
        }
    }

    ensureFresh(): Promise<void> {
        if (this.inflightRefresh) return this.inflightRefresh
        const now = this.ports.clock.now()
        if (this.shared && this.shared.access.expiresAt > now + this.config.refreshLeadMs) return Promise.resolve()
        return this.refreshNow()
    }

    refreshNow(): Promise<void> {
        if (this.inflightRefresh) return this.inflightRefresh
        this.setState({...this.state, refreshing: true})
        this.notifyListeners()
        this.inflightRefresh = this.doRefreshCrossTab().finally(() => {
            this.inflightRefresh = null
            this.setState({...this.state, refreshing: false})
            this.notifyListeners()
        })
        return this.inflightRefresh
    }

    private async doRefreshCrossTab(): Promise<void> {
        await this.ports.lock.withLock("auth-refresh", async () => {
            const cached = this.ports.cache.read()
            const now = this.ports.clock.now()

            if (
                cached != null &&
                cached.access.expiresAt > now + this.config.clockSkewMs &&
                cached.access.token !== this.shared?.access.token
            ) {
                this.adoptRoot(cached)
                return
            }

            if (this.shared && this.shared.access.expiresAt > now + this.config.refreshLeadMs) {
                return
            }

            if (!this.canRefresh()) {
                this.toExpired()
                throw new Error("No refresh token")
            }

            let result: AuthResult
            try {
                result = await this.refreshWithRetries()
            } catch (e) {
                if (this.config.isFatalRefreshError(e)) {
                    this.toExpired()
                } else {
                    this.markDegraded()
                }
                throw e
            }

            this.identity = result.data
            const next: GGTokenPair = {
                access: result.tokens.access,
                refresh: this.config.storage === "cookie"
                    ? undefined
                    : (result.tokens.refresh ?? this.shared?.refresh),
            }
            this.commitShared(next)
        })
    }

    // Retry a failed refresh a few times with exponential backoff before giving
    // up. Runs inside the cross-tab lock, so only one tab ever retries — the
    // others stay queued on the lock and then adopt the refreshed token from
    // cache (no stampede on the refresh endpoint). A fatal error short-circuits
    // immediately (expire, don't retry). Each attempt is bounded by
    // withRefreshTimeout, so a hung attempt still advances to the next.
    private async refreshWithRetries(): Promise<AuthResult> {
        const retries = Math.max(0, this.config.refreshRetries ?? 0)
        let lastErr: unknown
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await this.withRefreshTimeout(this.config.refresh(this.currentRefreshToken()))
            } catch (e) {
                lastErr = e
                if (this.config.isFatalRefreshError(e) || attempt === retries) throw e
                await this.delay(this.backoffMs(attempt))
            }
        }
        throw lastErr
    }

    private backoffMs(attempt: number): number {
        return (this.config.refreshRetryDelayMs ?? 500) * 2 ** attempt
    }

    private delay(ms: number): Promise<void> {
        if (ms <= 0) return Promise.resolve()
        return new Promise((resolve) => { this.ports.scheduler.schedule(ms, resolve) })
    }

    // Race the refresh against a scheduler-driven deadline. The timer is the
    // injected scheduler (not setTimeout) so tests drive it deterministically.
    // A timed-out refresh's underlying request is left to settle on its own and
    // its result discarded — the next ensureFresh starts a fresh attempt.
    private withRefreshTimeout(p: Promise<AuthResult>): Promise<AuthResult> {
        const ms = this.config.refreshTimeoutMs
        if (!ms || ms <= 0) return p
        return new Promise<AuthResult>((resolve, reject) => {
            const cancel = this.ports.scheduler.schedule(ms, () => reject(new GGAuthRefreshTimeoutError(ms)))
            p.then(
                (r) => { cancel(); resolve(r) },
                (e) => { cancel(); reject(e) },
            )
        })
    }

    selectDerived(key: string, params: unknown): Promise<void> {
        const cfg = this.derivedCfgMap[key]
        if (!cfg) throw new Error(`No derived config for "${key}"`)

        const entry = this.derivedState.get(key)!
        const pk = stableKey(params)

        const existing = entry.pool.get(pk)
        if (existing && existing.result.access.expiresAt > this.ports.clock.now() + this.config.clockSkewMs) {
            entry.active = pk
            cfg.key.set(existing.result.access.token)
            this.notifyListeners()
            return Promise.resolve()
        }

        const inflightKey = key + "\0" + pk
        const existingFlight = this.inflightDerivedMint.get(inflightKey)
        if (existingFlight) return existingFlight

        const promise = (async () => {
            await this.ensureFresh()
            const result = await cfg.mint(params)
            entry.pool.set(pk, {params, result})
            entry.active = pk
            cfg.key.set(result.access.token)
            this.notifyListeners()
        })().finally(() => {
            this.inflightDerivedMint.delete(inflightKey)
        })

        this.inflightDerivedMint.set(inflightKey, promise)
        return promise
    }

    clearDerived(key: string): void {
        const cfg = this.derivedCfgMap[key]
        if (cfg) cfg.key.set(undefined)
        const entry = this.derivedState.get(key)
        if (entry) entry.active = undefined
        this.notifyListeners()
    }

    getDerived(key: string): unknown {
        const entry = this.derivedState.get(key)
        if (!entry?.active) return undefined
        return entry.pool.get(entry.active)?.result.data
    }

    remintActiveDerived(key: string): Promise<void> {
        const cfg = this.derivedCfgMap[key]
        const entry = this.derivedState.get(key)
        if (!cfg || !entry?.active) return Promise.resolve()

        const pk = entry.active
        const inflightKey = key + "\0" + pk
        const existing = this.inflightDerivedMint.get(inflightKey)
        if (existing) return existing

        const poolEntry = entry.pool.get(pk)
        if (!poolEntry) return Promise.resolve()

        const promise = (async () => {
            const result = await cfg.mint(poolEntry.params)
            entry.pool.set(pk, {params: poolEntry.params, result})
            cfg.key.set(result.access.token)
            this.notifyListeners()
        })().finally(() => {
            this.inflightDerivedMint.delete(inflightKey)
        })

        this.inflightDerivedMint.set(inflightKey, promise)
        return promise
    }

    getAccessToken(opts?: {awaitRefresh?: boolean}): Promise<string | undefined> {
        if (opts?.awaitRefresh ?? true) return this.ensureFresh().then(() => this.config.key.get())
        return Promise.resolve(this.config.key.get())
    }

    isRootStale(): boolean {
        return !this.shared || this.shared.access.expiresAt <= this.ports.clock.now() + this.config.clockSkewMs
    }

    isDerivedStale(key: string): boolean {
        const entry = this.derivedState.get(key)
        if (!entry?.active) return false
        const poolEntry = entry.pool.get(entry.active)
        if (!poolEntry) return true
        return poolEntry.result.access.expiresAt <= this.ports.clock.now() + this.config.clockSkewMs
    }

    ensureActiveDerivedFresh(key: string): Promise<void> {
        const entry = this.derivedState.get(key)
        if (!entry?.active) return Promise.resolve()
        if (!this.isDerivedStale(key)) return Promise.resolve()
        return this.remintActiveDerived(key)
    }

    private adoptRoot(s: StoredAuth): void {
        this.shared = {access: s.access, refresh: s.refresh}
        this.identity = s.data
        this.config.key.set(s.access.token)
        this.setState({status: "authenticated", refreshing: false, degraded: false})
        this.scheduleNextRefresh()
        this.notifyListeners()
    }

    private commitShared(s: GGTokenPair): void {
        this.shared = s
        this.config.key.set(s.access.token)
        this.cacheWrite({...s, data: this.identity})
        this.setState({status: "authenticated", refreshing: this.state.refreshing, degraded: false})
        this.scheduleNextRefresh()
        this.fireRefreshed()
        this.notifyListeners()
    }

    private cacheWrite(v: StoredAuth | undefined): void {
        this.writing = true
        try {
            this.ports.cache.write(v)
        } finally {
            this.writing = false
        }
    }

    private scheduleNextRefresh(): void {
        this.cancelNextRefresh()
        if (!this.shared) return
        const now = this.ports.clock.now()
        const delay = Math.max(0, this.shared.access.expiresAt - this.config.refreshLeadMs - now)
        // Background refresh is fire-and-forget; failures already surface via state
        // (degraded/expired), so swallow the rejection to avoid an unhandled one.
        this.cancelScheduled = this.ports.scheduler.schedule(delay, () => { void this.ensureFresh().catch(() => {}) })
    }

    private cancelNextRefresh(): void {
        if (this.cancelScheduled) {
            this.cancelScheduled()
            this.cancelScheduled = null
        }
    }

    private toExpired(): void {
        this.clearRootWire()
        this.clearAllDerivedWires()
        this.shared = undefined
        this.identity = undefined
        this.setState({status: "expired", refreshing: false, degraded: false})
        this.fireLogout()
        this.notifyListeners()
    }

    private markDegraded(): void {
        this.setState({...this.state, degraded: true})
        this.notifyListeners()
    }

    private onCrossTab(incoming: StoredAuth | undefined): void {
        if (this.writing) return
        if (!incoming) {
            this.shared = undefined
            this.identity = undefined
            this.clearRootWire()
            this.clearAllDerivedWires()
            this.cancelNextRefresh()
            this.setState({status: "anonymous", refreshing: false, degraded: false})
            this.fireLogout()
            this.notifyListeners()
            return
        }
        if (incoming.access.token !== this.shared?.access.token) {
            this.adoptRoot(incoming)
            this.fireRefreshed()
        }
    }

    private currentRefreshToken(): string | undefined {
        return this.config.storage === "cookie" ? undefined : this.shared?.refresh?.token
    }

    private canRefresh(): boolean {
        return this.config.storage === "cookie" ? true : !!this.shared?.refresh?.token
    }

    private clearRootWire(): void {
        this.config.key.set(undefined)
    }

    private clearAllDerivedWires(): void {
        for (const key of Object.keys(this.derivedCfgMap)) {
            this.derivedCfgMap[key].key.set(undefined)
            const entry = this.derivedState.get(key)
            if (entry) {
                entry.pool.clear()
                entry.active = undefined
            }
        }
    }

    private setState(next: SessionState): void {
        this.state = next
    }

    private notifyListeners(): void {
        for (const l of this.stateListeners) l()
    }

    private fireRefreshed(): void {
        for (const l of this.refreshedListeners) l()
    }

    private fireLogout(): void {
        for (const l of this.logoutListeners) l()
    }
}
