// The one canonical token shape — used by AuthToken returns, the API contract, the session's
// in-memory + localStorage storage, and the wire's outbound value(). Zero transforms between them.
export interface GGTokenPair {
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

export interface Clock { now(): number }
export interface CrossTabLock { withLock<T>(name: string, fn: () => Promise<T>): Promise<T> }

// The persisted session value: the token pair plus the identity `data` captured from the auth
// response. Persisting `data` is what lets session.get() survive a reload and cross-tab adopt
// without ever decoding the (opaque) access token.
export interface StoredAuth extends GGTokenPair {
    data?: unknown
}

// What refresh() yields back: the rotated token pair plus the re-resolved identity.
export interface AuthResult {
    tokens: GGTokenPair
    data?: unknown
}

export interface SharedCache {
    read(): StoredAuth | undefined
    write(v: StoredAuth | undefined): void
    subscribe(cb: (v: StoredAuth | undefined) => void): () => void
}
export interface Scheduler { schedule(delayMs: number, fn: () => void): () => void; onWake(cb: () => void): () => void }

export interface CoreConfig<D extends DerivedMap = {}> {
    refresh: (refreshToken?: string) => Promise<AuthResult>
    key: TokenKey
    derived?: D
    storage: "localStorage" | "cookie"
    logout?: () => Promise<void>
    refreshLeadMs: number
    clockSkewMs: number
    // Upper bound on a single refresh call. A refresh that never settles (server
    // down, dropped connection, a sibling tab stuck holding the cross-tab lock)
    // would otherwise pin `inflightRefresh` and the "auth-refresh" lock forever,
    // freezing every authed call across all tabs. On timeout the refresh is
    // treated as a non-fatal failure (degraded + retry), releasing the lock.
    // Undefined or <= 0 disables the bound.
    refreshTimeoutMs?: number
    isFatalRefreshError: (err: unknown) => boolean
}

export interface CorePorts {
    clock: Clock
    lock: CrossTabLock
    cache: SharedCache
    scheduler: Scheduler
}
