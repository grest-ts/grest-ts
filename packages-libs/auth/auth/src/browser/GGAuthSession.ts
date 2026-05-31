/// <reference lib="dom" />
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {GGWireContextKey} from "@grest-ts/http"
import {BaseAuthSession} from "./GGAuthSessionBase"
import {systemClock} from "./core/systemClock"
import {localStorageSharedCache} from "./core/localStorageCache"
import {webLocksLock} from "./core/webLocksLock"
import {browserScheduler} from "./core/browserScheduler"
import type {DerivedConfig, DerivedData, DerivedMap, DerivedParams, DerivedTokenResult, GGTokenPair, SessionState} from "./core/types"
import type {DerivedToken} from "./GGAuthSessionBase"

// A credential wire carrying its permission enum P — withToken/addDerived take these directly,
// so the session infers its permission union (Perm) from the wires it holds.
type Wire<P extends string> = GGWireContextKey<P>

export interface GGTokenSessionConfig {
    refresh: (token: {refreshToken: string}) => Promise<GGTokenPair>
    localStorageKey: string
}

export interface GGCookieSessionConfig {
    refresh: () => Promise<GGTokenPair>
    logout: () => Promise<void>
}

// UX-only: decode the (forgeable) JWT's `permissions` claim. The server re-verifies on every call.
function decodePermissions(token: string | undefined): string[] {
    if (!token) return []
    try {
        const seg = token.split(".")[1]
        if (!seg) return []
        const json = atob(seg.replace(/-/g, "+").replace(/_/g, "/"))
        const payload = JSON.parse(json) as {permissions?: unknown}
        return Array.isArray(payload.permissions) ? payload.permissions.map(String) : []
    } catch {
        return []
    }
}

export class GGAuthSession<D extends DerivedMap = {}, Perm extends string = never> {
    private _session: BaseAuthSession<D> | null = null
    private readonly _rootKey: Wire<Perm>
    private readonly _refresh: (refreshToken?: string) => Promise<GGTokenPair>
    private readonly _logout: (() => Promise<void>) | undefined
    private readonly _storage: "localStorage" | "cookie"
    private readonly _cacheKey: string
    private readonly _derivedConfigs: Record<string, {key: Wire<string>; mint: (params: unknown) => Promise<DerivedTokenResult<unknown>>}> = {}
    private _identity: unknown = undefined

    private constructor(
        key: Wire<Perm>,
        refresh: (refreshToken?: string) => Promise<GGTokenPair>,
        storage: "localStorage" | "cookie",
        logout: (() => Promise<void>) | undefined,
        cacheKey: string,
    ) {
        this._rootKey = key
        this._refresh = refresh
        this._storage = storage
        this._logout = logout
        this._cacheKey = cacheKey
    }

    static withToken<WP extends string>(key: Wire<WP>, config: GGTokenSessionConfig): GGAuthSession<{}, WP> {
        return new GGAuthSession<{}, WP>(
            key,
            (token) => config.refresh({refreshToken: token!}),
            "localStorage",
            undefined,
            config.localStorageKey,
        )
    }

    static withCookie<WP extends string>(key: Wire<WP>, config: GGCookieSessionConfig): GGAuthSession<{}, WP> {
        return new GGAuthSession<{}, WP>(key, () => config.refresh(), "cookie", config.logout, "")
    }

    public addDerived<N extends string, Par, DData, WP extends string>(
        name: N,
        key: Wire<WP>,
        config: {mint: (params: Par) => Promise<DerivedTokenResult<DData>>},
    ): GGAuthSession<D & {[K in N]: DerivedConfig<Par, DData>}, Perm | WP> {
        this._derivedConfigs[name] = {key, mint: config.mint as (params: unknown) => Promise<DerivedTokenResult<unknown>>}
        return this as unknown as GGAuthSession<D & {[K in N]: DerivedConfig<Par, DData>}, Perm | WP>
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
                refreshLeadMs: 60_000,
                clockSkewMs: 10_000,
                isFatalRefreshError: (e) => e instanceof NOT_AUTHORIZED,
            },
            {
                clock: systemClock,
                lock: webLocksLock(),
                cache: localStorageSharedCache(this._cacheKey),
                scheduler: browserScheduler(),
            },
        )

        // The session configures the wires itself — defineClient is the typed successor to the
        // GGContextKeySynchronizer.provide() it used to call. value() reads the token the engine
        // stored; isStale/recover gate the outbound read so a stale token refreshes before send.
        this._rootKey.defineClient({
            value: () => this._rootKey.get(),
            isStale: () => this._session!.isRootStale(),
            recover: () => this._session!.ensureFresh(),
        })

        for (const [name, {key}] of Object.entries(this._derivedConfigs)) {
            key.defineClient({
                value: () => key.get(),
                isStale: () => this._session!.isDerivedStale(name),
                recover: () => this._session!.ensureActiveDerivedFresh(name),
            })
        }

        return this._session
    }

    get derived(): {[K in keyof D]: DerivedToken<DerivedParams<D[K]>, DerivedData<D[K]>>} {
        return this._getSession().derived
    }

    public start(pair: GGTokenPair & {data?: unknown}): void {
        this._identity = pair.data
        this._getSession().start(pair)
    }

    public logout(): void {
        this._identity = undefined
        this._getSession().logout()
    }

    public init(): Promise<void> {
        return this._getSession().init()
    }

    public getState(): SessionState {
        return this._getSession().getState()
    }

    public isLoggedIn(): boolean {
        return this.getState().status === "authenticated"
    }

    /**
     * Convenience: authenticate then store the resulting tokens. The session is transport-agnostic
     * and is not wired to a login endpoint here — the app calls its typed `api.<auth>.login(...)`
     * and passes the result to start(). Provided for the credential-login shape; configure a handler
     * to use it directly.
     */
    public login(_credentials: unknown): Promise<void> {
        throw new Error("GGAuthSession.login: no login handler configured — call your typed auth client's login(...) and pass the result to session.start(...).")
    }

    /** The identity captured from the last start() (e.g. the login response's `data`). */
    public get(): any {
        return this._identity
    }

    /** All granted permissions across the active tokens (root + active derived). UX only. */
    public get permissions(): Perm[] {
        return [...this._grantedPermissions()] as Perm[]
    }

    /** Typed to the union of the session's wires' permission enums. UX gate only — server re-checks. */
    public hasPermission(permission: Perm): boolean {
        return this._grantedPermissions().has(permission)
    }

    private _grantedPermissions(): Set<string> {
        const out = new Set<string>()
        for (const token of this._activeTokens()) {
            for (const p of decodePermissions(token)) out.add(p)
        }
        return out
    }

    private _activeTokens(): (string | undefined)[] {
        const tokens: (string | undefined)[] = [this._rootKey.get()]
        for (const {key} of Object.values(this._derivedConfigs)) tokens.push(key.get())
        return tokens
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
