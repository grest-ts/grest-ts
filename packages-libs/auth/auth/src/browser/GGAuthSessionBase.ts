import type {
    AccessOnly,
    CoreConfig,
    CorePorts,
    DerivedConfig,
    DerivedMap,
    DerivedParams,
    DerivedResult,
    SessionState,
    SharedTokens,
    TokenPair,
} from "./core/types"

// Data fields of T that aren't part of the token bookkeeping.
type DerivedData<T extends AccessOnly> = Partial<Omit<T, keyof AccessOnly>>

// Public handle for a derived token slot. Methods drive the lifecycle;
// data properties proxy the current active result's fields.
export type DerivedToken<P, T extends AccessOnly = AccessOnly> = {
    select(params: P): Promise<void>
    clear(): void
    get(): T | undefined
} & DerivedData<T>

function makeDerivedToken<P, T extends AccessOnly>(
    _select: (params: P) => Promise<void>,
    _clear: () => void,
    _get: () => T | undefined,
): DerivedToken<P, T> {
    const methods = {select: _select, clear: _clear, get: _get}
    return new Proxy(methods as object, {
        get(target, prop) {
            if (prop in target) return (target as Record<string, unknown>)[prop as string]
            return _get()?.[prop as keyof T]
        },
    }) as unknown as DerivedToken<P, T>
}

interface DerivedEntry {
    pool: Map<string, { params: unknown; token: unknown }>
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

    private shared: SharedTokens | undefined = undefined
    private state: SessionState = {status: "anonymous", refreshing: false, degraded: false}
    private inflightRefresh: Promise<void> | null = null
    private readonly inflightDerivedMint = new Map<string, Promise<void>>()
    private cancelScheduled: (() => void) | null = null
    private writing = false

    private readonly stateListeners = new Set<() => void>()
    private readonly refreshedListeners = new Set<() => void>()
    private readonly logoutListeners = new Set<() => void>()

    private readonly derivedState = new Map<string, DerivedEntry>()

    readonly derived: {[K in keyof D]: DerivedToken<DerivedParams<D[K]>, DerivedResult<D[K]>>}

    private get derivedCfgMap(): Record<string, DerivedConfig<any, any>> {
        return (this.config.derived ?? {}) as Record<string, DerivedConfig<any, any>>
    }

    constructor(config: CoreConfig<D>, ports: CorePorts) {
        this.config = config
        this.ports = ports

        const derivedMap = config.derived ?? ({} as D)
        const handles = {} as {[K in keyof D]: DerivedToken<DerivedParams<D[K]>, DerivedResult<D[K]>>}
        for (const key of Object.keys(derivedMap) as (keyof D & string)[]) {
            this.derivedState.set(key, {pool: new Map(), active: undefined})
            handles[key] = makeDerivedToken(
                (params) => this.selectDerived(key, params),
                () => this.clearDerived(key),
                () => this.getDerived(key) as DerivedResult<D[typeof key]> | undefined,
            ) as any
        }
        this.derived = handles

        ports.cache.subscribe((incoming) => this.onCrossTab(incoming))
        ports.scheduler.onWake(() => void this.ensureFresh())
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
            if (!cached?.root) {
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
            if (cached.root.accessExpiresAt <= now + this.config.clockSkewMs) {
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

        if (!cached?.root) {
            this.setState({status: "anonymous", refreshing: false, degraded: false})
            this.notifyListeners()
            return
        }

        this.adoptRoot(cached)
        this.setState({...this.state, status: "restoring"})
        this.notifyListeners()

        if (cached.root.accessExpiresAt <= now + this.config.clockSkewMs) {
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

    start(pair: TokenPair): void {
        const next: SharedTokens = {
            root: {accessToken: pair.accessToken, accessExpiresAt: pair.accessExpiresAt},
            refreshToken: this.config.storage === "cookie" ? undefined : pair.refreshToken,
        }
        this.commitShared(next)
    }

    logout(): void {
        this.shared = undefined
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
        if (this.shared && this.shared.root.accessExpiresAt > now + this.config.refreshLeadMs) return Promise.resolve()
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
                cached.root.accessExpiresAt > now + this.config.clockSkewMs &&
                cached.root.accessToken !== this.shared?.root.accessToken
            ) {
                this.adoptRoot(cached)
                return
            }

            if (this.shared && this.shared.root.accessExpiresAt > now + this.config.refreshLeadMs) {
                return
            }

            if (!this.canRefresh()) {
                this.toExpired()
                throw new Error("No refresh token")
            }

            let result: TokenPair
            try {
                result = await this.config.refresh(this.currentRefreshToken())
            } catch (e) {
                if (this.config.isFatalRefreshError(e)) {
                    this.toExpired()
                } else {
                    this.markDegraded()
                }
                throw e
            }

            const next: SharedTokens = {
                root: {accessToken: result.accessToken, accessExpiresAt: result.accessExpiresAt},
                refreshToken: this.config.storage === "cookie"
                    ? undefined
                    : (result.refreshToken ?? this.shared?.refreshToken),
            }
            this.commitShared(next)
        })
    }

    selectDerived(key: string, params: unknown): Promise<void> {
        const cfg = this.derivedCfgMap[key]
        if (!cfg) throw new Error(`No derived config for "${key}"`)

        const entry = this.derivedState.get(key)!
        const pk = stableKey(params)

        const existing = entry.pool.get(pk)
        if (existing && (existing.token as AccessOnly).accessExpiresAt > this.ports.clock.now() + this.config.clockSkewMs) {
            entry.active = pk
            cfg.key.set((existing.token as AccessOnly).accessToken)
            this.notifyListeners()
            return Promise.resolve()
        }

        const inflightKey = key + "\0" + pk
        const existingFlight = this.inflightDerivedMint.get(inflightKey)
        if (existingFlight) return existingFlight

        const promise = (async () => {
            await this.ensureFresh()
            const token = await cfg.mint(params)
            entry.pool.set(pk, {params, token})
            entry.active = pk
            cfg.key.set(token.accessToken)
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
        return entry.pool.get(entry.active)?.token
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
            const token = await cfg.mint(poolEntry.params)
            entry.pool.set(pk, {params: poolEntry.params, token})
            cfg.key.set(token.accessToken)
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
        return !this.shared || this.shared.root.accessExpiresAt <= this.ports.clock.now() + this.config.clockSkewMs
    }

    isDerivedStale(key: string): boolean {
        const entry = this.derivedState.get(key)
        if (!entry?.active) return false
        const poolEntry = entry.pool.get(entry.active)
        if (!poolEntry) return true
        return (poolEntry.token as AccessOnly).accessExpiresAt <= this.ports.clock.now() + this.config.clockSkewMs
    }

    ensureActiveDerivedFresh(key: string): Promise<void> {
        const entry = this.derivedState.get(key)
        if (!entry?.active) return Promise.resolve()
        if (!this.isDerivedStale(key)) return Promise.resolve()
        return this.remintActiveDerived(key)
    }

    private adoptRoot(s: SharedTokens): void {
        this.shared = s
        this.config.key.set(s.root.accessToken)
        this.setState({status: "authenticated", refreshing: false, degraded: false})
        this.scheduleNextRefresh()
        this.notifyListeners()
    }

    private commitShared(s: SharedTokens): void {
        this.shared = s
        this.config.key.set(s.root.accessToken)
        this.cacheWrite(s)
        this.setState({status: "authenticated", refreshing: this.state.refreshing, degraded: false})
        this.scheduleNextRefresh()
        this.fireRefreshed()
        this.notifyListeners()
    }

    private cacheWrite(v: SharedTokens | undefined): void {
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
        const delay = Math.max(0, this.shared.root.accessExpiresAt - this.config.refreshLeadMs - now)
        this.cancelScheduled = this.ports.scheduler.schedule(delay, () => void this.ensureFresh())
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
        this.setState({status: "expired", refreshing: false, degraded: false})
        this.fireLogout()
        this.notifyListeners()
    }

    private markDegraded(): void {
        this.setState({...this.state, degraded: true})
        this.notifyListeners()
    }

    private onCrossTab(incoming: SharedTokens | undefined): void {
        if (this.writing) return
        if (!incoming) {
            this.shared = undefined
            this.clearRootWire()
            this.clearAllDerivedWires()
            this.cancelNextRefresh()
            this.setState({status: "anonymous", refreshing: false, degraded: false})
            this.fireLogout()
            this.notifyListeners()
            return
        }
        if (incoming.root.accessToken !== this.shared?.root.accessToken) {
            this.adoptRoot(incoming)
            this.fireRefreshed()
        }
    }

    private currentRefreshToken(): string | undefined {
        return this.config.storage === "cookie" ? undefined : this.shared?.refreshToken
    }

    private canRefresh(): boolean {
        return this.config.storage === "cookie" ? true : !!this.shared?.refreshToken
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
