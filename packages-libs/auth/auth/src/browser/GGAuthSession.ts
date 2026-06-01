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

type Wire = GGWireContextKey

// What the auth endpoints return verbatim: the GGAuth token pair under `tokens`, plus the
// identity `data`. The session consumes this shape directly — no flattening/re-wrapping at the
// call site — and captures `data` as the current identity on every login/refresh.
export interface GGAuthResult {
    tokens: GGTokenPair
    data?: unknown
}

export interface GGTokenSessionConfig {
    refresh: (token: {refreshToken: string}) => Promise<GGAuthResult>
    localStorageKey: string
}

export interface GGCookieSessionConfig {
    refresh: () => Promise<GGAuthResult>
    logout: () => Promise<void>
}

export class GGAuthSession<D extends DerivedMap = {}> {
    private _session: BaseAuthSession<D> | null = null
    private readonly _rootKey: Wire
    private readonly _refresh: (refreshToken?: string) => Promise<GGAuthResult>
    private readonly _logout: (() => Promise<void>) | undefined
    private readonly _storage: "localStorage" | "cookie"
    private readonly _cacheKey: string
    private readonly _derivedConfigs: Record<string, {key: Wire; mint: (params: unknown) => Promise<DerivedTokenResult<unknown>>}> = {}
    private _identity: unknown = undefined

    // Protected (not private) + `new this` in the factories so an app can subclass to add its
    // own helpers (e.g. hasPermission over get()) — see examples/auth/client/src/api.ts.
    protected constructor(
        key: Wire,
        refresh: (refreshToken?: string) => Promise<GGAuthResult>,
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

    static withToken(key: Wire, config: GGTokenSessionConfig): GGAuthSession<{}> {
        return new this(
            key,
            (token) => config.refresh({refreshToken: token!}),
            "localStorage",
            undefined,
            config.localStorageKey,
        )
    }

    static withCookie(key: Wire, config: GGCookieSessionConfig): GGAuthSession<{}> {
        return new this(key, () => config.refresh(), "cookie", config.logout, "")
    }

    public addDerived<N extends string, Par, DData>(
        name: N,
        key: Wire,
        config: {mint: (params: Par) => Promise<DerivedTokenResult<DData>>},
    ): GGAuthSession<D & {[K in N]: DerivedConfig<Par, DData>}> {
        this._derivedConfigs[name] = {key, mint: config.mint as (params: unknown) => Promise<DerivedTokenResult<unknown>>}
        return this as unknown as GGAuthSession<D & {[K in N]: DerivedConfig<Par, DData>}>
    }

    private _getSession(): BaseAuthSession<D> {
        if (this._session) return this._session

        const derived = Object.fromEntries(
            Object.entries(this._derivedConfigs).map(([name, {key, mint}]) => [name, {key, mint}]),
        ) as unknown as D

        this._session = new BaseAuthSession<D>(
            {
                // Capture the re-resolved identity `data` the refresh response carries, so the
                // client's identity/permissions stay current without ever decoding the token.
                refresh: async (token) => {
                    const result = await this._refresh(token)
                    if (result.data !== undefined) this._identity = result.data
                    return result.tokens
                },
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
        // GGContextKeySynchronizer.provide() it used to call. The engine stores the token in the
        // wire; isStale/recover gate the outbound read so a stale token refreshes before send.
        this._rootKey.defineClient({
            isStale: () => this._session!.isRootStale(),
            recover: () => this._session!.ensureFresh(),
        })

        for (const [name, {key}] of Object.entries(this._derivedConfigs)) {
            key.defineClient({
                isStale: () => this._session!.isDerivedStale(name),
                recover: () => this._session!.ensureActiveDerivedFresh(name),
            })
        }

        return this._session
    }

    get derived(): {[K in keyof D]: DerivedToken<DerivedParams<D[K]>, DerivedData<D[K]>>} {
        return this._getSession().derived
    }

    public start(result: GGAuthResult): void {
        this._identity = result.data
        this._getSession().start(result.tokens)
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

    /**
     * The identity captured from the last start() / refresh response `data`. Permission gates
     * are intentionally NOT on the session — the session can't read the opaque access token, and
     * permission shape is app-specific. Subclass and read this to add your own UX gate, e.g.:
     *
     *   class AppSession extends GGAuthSession<{org: DerivedConfig<SelectOrgRequest, Org>}> {
     *     hasPermission(p: UserPermission) { return (this.get() as User)?.permissions.includes(p) }
     *   }
     */
    public get(): any {
        return this._identity
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
