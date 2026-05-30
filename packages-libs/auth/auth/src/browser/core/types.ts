export interface AccessOnly { accessToken: string; accessExpiresAt: number }
export interface TokenPair {
    access: {token: string; expiresAt: number}
    refresh?: {token: string; expiresAt: number}
}

export interface TokenKey {
    name: string
    get(): string | undefined
    set(token: string | undefined): void
}

export interface DerivedTokenResult<D = unknown> {
    access: {token: string; expiresAt: number}
    data: D
}

export interface DerivedConfig<P = void, D = unknown> { key: TokenKey; mint: (params: P) => Promise<DerivedTokenResult<D>> }
export type DerivedMap = Record<string, DerivedConfig<any, any>>
// Extracts P and D from a specific DerivedConfig without losing them through the DerivedMap constraint.
export type DerivedParams<C> = C extends DerivedConfig<infer P, any> ? P : never
export type DerivedData<C> = C extends DerivedConfig<any, infer D> ? D : never

export type SessionStatus = "anonymous" | "restoring" | "authenticated" | "expired"
export interface SessionState {
    status: SessionStatus;
    refreshing: boolean;
    degraded: boolean
}

export interface SharedTokens {
    refreshToken?: string;
    root: AccessOnly
}

export interface Clock { now(): number }
export interface CrossTabLock { withLock<T>(name: string, fn: () => Promise<T>): Promise<T> }
export interface SharedCache {
    read(): SharedTokens | undefined
    write(v: SharedTokens | undefined): void
    subscribe(cb: (v: SharedTokens | undefined) => void): () => void
}
export interface Scheduler { schedule(delayMs: number, fn: () => void): () => void; onWake(cb: () => void): () => void }

export interface CoreConfig<D extends DerivedMap = {}> {
    refresh: (refreshToken?: string) => Promise<TokenPair>
    key: TokenKey
    derived?: D
    storage: "localStorage" | "cookie"
    logout?: () => Promise<void>
    refreshLeadMs: number
    clockSkewMs: number
    isFatalRefreshError: (err: unknown) => boolean
}

export interface CorePorts {
    clock: Clock
    lock: CrossTabLock
    cache: SharedCache
    scheduler: Scheduler
}
