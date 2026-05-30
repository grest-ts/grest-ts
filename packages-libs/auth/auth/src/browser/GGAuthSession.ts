/// <reference lib="dom" />
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {GGContextKeySynchronizer, type GGContextKey} from "@grest-ts/context"
import {BaseAuthSession} from "./GGAuthSessionBase"
import {systemClock} from "./core/systemClock"
import {localStorageSharedCache} from "./core/localStorageCache"
import {webLocksLock} from "./core/webLocksLock"
import {browserScheduler} from "./core/browserScheduler"
import type {AccessOnly, DerivedConfig, DerivedMap, DerivedParams, DerivedResult, SessionState, TokenKey, TokenPair} from "./core/types"
import type {DerivedToken} from "./GGAuthSessionBase"

export interface GGAuthSessionOptions {
    cacheKey?: string
    refreshLeadMs?: number
    clockSkewMs?: number
    isFatalRefreshError?: (err: unknown) => boolean
}

export class GGAuthSession<D extends DerivedMap = {}> {
    private _session: BaseAuthSession<D> | null = null
    private readonly _rootKey: TokenKey
    private readonly _refresh: (refreshToken?: string) => Promise<TokenPair>
    private readonly _logout: (() => Promise<void>) | undefined
    private readonly _storage: "localStorage" | "cookie"
    private readonly _options: GGAuthSessionOptions
    private readonly _derivedConfigs: Record<string, {key: TokenKey; mint: (params: unknown) => Promise<AccessOnly>}> = {}

    private constructor(
        key: TokenKey,
        refresh: (refreshToken?: string) => Promise<TokenPair>,
        storage: "localStorage" | "cookie",
        logout: (() => Promise<void>) | undefined,
        options: GGAuthSessionOptions,
    ) {
        this._rootKey = key
        this._refresh = refresh
        this._storage = storage
        this._logout = logout
        this._options = options
    }

    static withToken(
        key: TokenKey,
        refresh: (token: string) => Promise<TokenPair>,
        options?: GGAuthSessionOptions,
    ): GGAuthSession {
        return new GGAuthSession(key, (token) => refresh(token!), "localStorage", undefined, options ?? {})
    }

    static withCookie(
        key: TokenKey,
        refresh: () => Promise<TokenPair>,
        logout: () => Promise<void>,
        options?: GGAuthSessionOptions,
    ): GGAuthSession {
        return new GGAuthSession(key, () => refresh(), "cookie", logout, options ?? {})
    }

    public addDerived<N extends string, P, T extends AccessOnly>(
        name: N,
        key: TokenKey,
        mint: (params: P) => Promise<T>,
    ): GGAuthSession<D & {[K in N]: DerivedConfig<P, T>}> {
        this._derivedConfigs[name] = {key, mint: mint as (params: unknown) => Promise<AccessOnly>}
        return this as unknown as GGAuthSession<D & {[K in N]: DerivedConfig<P, T>}>
    }

    private _getSession(): BaseAuthSession<D> {
        if (this._session) return this._session

        const derived = Object.fromEntries(
            Object.entries(this._derivedConfigs).map(([name, {key, mint}]) => [name, {key, mint}]),
        ) as unknown as D

        this._session = new BaseAuthSession<D>(
            {
                refresh: this._refresh,
                key: this._rootKey,
                derived,
                storage: this._storage,
                logout: this._logout,
                refreshLeadMs: this._options.refreshLeadMs ?? 60_000,
                clockSkewMs: this._options.clockSkewMs ?? 10_000,
                isFatalRefreshError: this._options.isFatalRefreshError ?? ((e) => e instanceof NOT_AUTHORIZED),
            },
            {
                clock: systemClock,
                lock: webLocksLock(),
                cache: localStorageSharedCache(this._options.cacheKey ?? "auth.session"),
                scheduler: browserScheduler(),
            },
        )

        GGContextKeySynchronizer.provide(this._rootKey as unknown as GGContextKey<string | undefined>, {
            isStale: () => this._session!.isRootStale(),
            recover: () => this._session!.ensureFresh(),
        })

        for (const [name, {key}] of Object.entries(this._derivedConfigs)) {
            GGContextKeySynchronizer.provide(key as unknown as GGContextKey<string | undefined>, {
                isStale: () => this._session!.isDerivedStale(name),
                recover: () => this._session!.ensureActiveDerivedFresh(name),
            })
        }

        return this._session
    }

    get derived(): {[K in keyof D]: DerivedToken<DerivedParams<D[K]>, DerivedResult<D[K]>>} {
        return this._getSession().derived
    }

    public start(pair: TokenPair): void {
        this._getSession().start(pair)
    }

    public logout(): void {
        this._getSession().logout()
    }

    public init(): Promise<void> {
        return this._getSession().init()
    }

    public getState(): SessionState {
        return this._getSession().getState()
    }

    public subscribe(listener: () => void): () => void {
        return this._getSession().subscribe(listener)
    }

    public onRefreshed(cb: () => void): () => void {
        return this._getSession().onRefreshed(cb)
    }

    public onLogout(cb: () => void): () => void {
        return this._getSession().onLogout(cb)
    }

    public getAccessToken(opts?: {awaitRefresh?: boolean}): Promise<string | undefined> {
        return this._getSession().getAccessToken(opts)
    }
}
