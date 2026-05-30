/// <reference lib="dom" />
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {GGContextKeySynchronizer, type GGContextKey} from "@grest-ts/context"
import {BaseAuthSession} from "./GGAuthSessionBase"
import {systemClock} from "./core/systemClock"
import {localStorageSharedCache} from "./core/localStorageCache"
import {webLocksLock} from "./core/webLocksLock"
import {browserScheduler} from "./core/browserScheduler"
import type {DerivedConfig, DerivedMap, DerivedParams, DerivedResult, SessionState, TokenKey, TokenPair} from "./core/types"
import type {DerivedToken} from "./GGAuthSessionBase"

export interface AuthSessionConfig<D extends DerivedMap = {}> {
    refresh: (refreshToken?: string) => Promise<TokenPair>
    key: TokenKey
    derived?: D
    refreshKeyStorage?: "localStorage" | "cookie"
    logout?: () => Promise<void>
    cacheKey?: string
    refreshLeadMs?: number
    clockSkewMs?: number
    isFatalRefreshError?: (err: unknown) => boolean
}

export class GGAuthSession<D extends DerivedMap = {}> {
    private readonly _session: BaseAuthSession<D>

    readonly derived: {[K in keyof D]: DerivedToken<DerivedParams<D[K]>, DerivedResult<D[K]>>}

    constructor(config: AuthSessionConfig<D>) {
        this._session = new BaseAuthSession<D>(
            {
                refresh: config.refresh,
                key: config.key,
                derived: config.derived,
                storage: config.refreshKeyStorage ?? "localStorage",
                logout: config.logout,
                refreshLeadMs: config.refreshLeadMs ?? 60_000,
                clockSkewMs: config.clockSkewMs ?? 10_000,
                isFatalRefreshError: config.isFatalRefreshError ?? ((e) => e instanceof NOT_AUTHORIZED),
            },
            {
                clock: systemClock,
                lock: webLocksLock(),
                cache: localStorageSharedCache(config.cacheKey ?? "auth.session"),
                scheduler: browserScheduler(),
            },
        )

        this.derived = this._session.derived

        GGContextKeySynchronizer.provide(config.key as unknown as GGContextKey<string | undefined>, {
            isStale: () => this._session.isRootStale(),
            recover: () => this._session.ensureFresh(),
        })

        for (const [key, d] of Object.entries(config.derived ?? {})) {
            const derived = d as DerivedConfig<unknown>
            GGContextKeySynchronizer.provide(derived.key as unknown as GGContextKey<string | undefined>, {
                isStale: () => this._session.isDerivedStale(key),
                recover: () => this._session.ensureActiveDerivedFresh(key),
            })
        }
    }

    public start(pair: TokenPair): void {
        this._session.start(pair)
    }

    public logout(): void {
        this._session.logout()
    }

    public init(): Promise<void> {
        return this._session.init()
    }

    public getState(): SessionState {
        return this._session.getState()
    }

    public subscribe(listener: () => void): () => void {
        return this._session.subscribe(listener)
    }

    public onRefreshed(cb: () => void): () => void {
        return this._session.onRefreshed(cb)
    }

    public onLogout(cb: () => void): () => void {
        return this._session.onLogout(cb)
    }

    public getAccessToken(opts?: {awaitRefresh?: boolean}): Promise<string | undefined> {
        return this._session.getAccessToken(opts)
    }
}
