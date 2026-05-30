/// <reference lib="dom" />
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {GGContextKeySynchronizer, type GGContextKey} from "@grest-ts/context"
import {BaseAuthSession as GGAuthSessionBase} from "./GGAuthSessionBase"
import {systemClock} from "./core/systemClock"
import {localStorageSharedCache} from "./core/localStorageCache"
import {webLocksLock} from "./core/webLocksLock"
import {browserScheduler} from "./core/browserScheduler"
import type {DerivedConfig, DerivedMap, TokenKey, TokenPair} from "./core/types"

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

export class GGAuthSession<D extends DerivedMap = {}> extends GGAuthSessionBase<D> {
    constructor(config: AuthSessionConfig<D>) {
        super(
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

        GGContextKeySynchronizer.provide(config.key as unknown as GGContextKey<string | undefined>, {
            isStale: () => this.isRootStale(),
            recover: () => this.ensureFresh(),
        })

        for (const [key, d] of Object.entries(config.derived ?? {})) {
            const derived = d as DerivedConfig<unknown>
            GGContextKeySynchronizer.provide(derived.key as unknown as GGContextKey<string | undefined>, {
                isStale: () => this.isDerivedStale(key),
                recover: () => this.ensureActiveDerivedFresh(key),
            })
        }
    }
}


