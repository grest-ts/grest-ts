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
// call site — and captures `data` as the current identity on every login/refresh. `I` is the
// app's identity type, inferred from the configured refresh response, so get() returns it.
export interface GGAuthResult<I = unknown> {
    tokens: GGTokenPair
    data?: I
}

export interface GGTokenSessionConfig<I = unknown> {
    refresh: (token: {refreshToken: string}) => Promise<GGAuthResult<I>>
    localStorageKey: string
}

export interface GGCookieSessionConfig<I = unknown> {
    refresh: () => Promise<GGAuthResult<I>>
    logout: () => Promise<void>
}

export class GGAuthSession<D extends DerivedMap = {}, I = unknown> {
    private _session: BaseAuthSession<D> | null = null
    private readonly _rootKey: Wire
    private readonly _refresh: (refreshToken?: string) => Promise<GGAuthResult<I>>
    private readonly _logout: (() => Promise<void>) | undefined
    private readonly _storage: "localStorage" | "cookie"
    private readonly _cacheKey: string
    private readonly _derivedConfigs: Record<string, {key: Wire; mint: (params: unknown) => Promise<DerivedTokenResult<unknown>>}> = {}

    // Protected (not private) + `new this` in the factories so an app can subclass to add its
    // own helpers (e.g. hasPermission over get()) — see examples/auth/client/src/api.ts.
    protected constructor(
        key: Wire,
        refresh: (refreshToken?: string) => Promise<GGAuthResult<I>>,
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

    static withToken<I = unknown>(key: Wire, config: GGTokenSessionConfig<I>): GGAuthSession<{}, I> {
        return new this(
            key,
            (token) => config.refresh({refreshToken: token!}),
            "localStorage",
            undefined,
            config.localStorageKey,
        ) as unknown as GGAuthSession<{}, I>
    }

    static withCookie<I = unknown>(key: Wire, config: GGCookieSessionConfig<I>): GGAuthSession<{}, I> {
        return new this(key, () => config.refresh(), "cookie", config.logout, "") as unknown as GGAuthSession<{}, I>
    }

    public addDerived<N extends string, Par, DData>(
        name: N,
        key: Wire,
        config: {mint: (params: Par) => Promise<DerivedTokenResult<DData>>},
    ): GGAuthSession<D & {[K in N]: DerivedConfig<Par, DData>}, I> {
        this._derivedConfigs[name] = {key, mint: config.mint as (params: unknown) => Promise<DerivedTokenResult<unknown>>}
        return this as unknown as GGAuthSession<D & {[K in N]: DerivedConfig<Par, DData>}, I>
    }

    private _getSession(): BaseAuthSession<D> {
        if (this._session) return this._session

        const derived = Object.fromEntries(
            Object.entries(this._derivedConfigs).map(([name, {key, mint}]) => [name, {key, mint}]),
        ) as unknown as D

        this._session = new BaseAuthSession<D>(
            {
                // The base persists the response's identity `data` alongside the tokens, so it
                // stays current (and survives reload) without ever decoding the token.
                refresh: (token) => this._refresh(token),
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

    public start(result: GGAuthResult<I>): void {
        this._getSession().start(result.tokens, result.data)
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
     * The identity (`I`) captured from the last start() / refresh response `data`, inferred from
     * the configured refresh response so it's typed here — no decoding the opaque access token.
     * Permission gates are intentionally NOT on the session (permission shape is app-specific);
     * subclass and read this to add your own UX gate, e.g.:
     *
     *   class AppSession extends GGAuthSession<{org: DerivedConfig<SelectOrgRequest, Org>}, User> {
     *     hasPermission(p: UserPermission) { return this.get()?.permissions.includes(p) }
     *   }
     */
    public get(): I | undefined {
        return this._session?.getIdentity() as I | undefined
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
