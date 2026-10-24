/// <reference lib="dom" />
import {decodeJwt} from "jose"
import {NOT_AUTHORIZED} from "@grest-ts/schema"

// Structurally GGAuthSession's GGAuthResult (exported only from @grest-ts/auth's browser entry).
export interface GGOAuthResult<I> {
    tokens: {access: {token: string, expiresAt: number}, refresh?: {token: string, expiresAt: number}}
    data: I
}

export interface GGOAuthClientConfig<I> {
    // Where the authorization server's metadata is (`{server}/.well-known/oauth-authorization-server`).
    // Responses are checked against the `issuer` it declares.
    server: string
    clientId: string
    redirectUri: string
    postLogoutRedirectUri?: string
    // RFC 8707 resource the access token is for; defaults to the issuer (an authorization server
    // protecting its own API). Always sent: a request with `openid` and no resource would get a
    // userinfo-only token instead of an API token.
    resource?: string
    scope?: string
    // The session's identity `data`, derived from the issued access token.
    identity: (accessToken: string) => I
    // Assumed refresh lifetime (the token response doesn't carry it). A server-side expiry earlier
    // than this surfaces as NOT_AUTHORIZED on refresh, which ends the session.
    refreshTtlMs?: number
}

type Pending = {state: string, verifier: string, returnTo?: string}
type Metadata = {issuer: string, authorization_endpoint: string, token_endpoint: string, revocation_endpoint?: string, end_session_endpoint?: string}

const PENDING_KEY = "gg-oauth-pending"

// Browser OAuth client (authorization code + PKCE S256), the `refresh` of a GGAuthSession — see README.
// The token/revocation endpoints are OAuth protocol endpoints (form-encoded), not grest-ts contracts.
export class GGOAuthClient<I = unknown> {

    private metadata: Promise<Metadata> | undefined
    // Set when a redirect away has started: a second one (e.g. a signed-out view starting sign-in
    // while logout is redirecting) would race it.
    private leaving = false

    private readonly config: GGOAuthClientConfig<I>

    constructor(config: GGOAuthClientConfig<I>) {
        this.config = config
    }

    // Redirects the browser to the authorization server; resolves never (the page unloads).
    public authorize = async (opts?: {returnTo?: string}): Promise<void> => {
        if (this.leaving) return await new Promise(() => undefined)
        this.leaving = true
        const meta = await this.discover()
        const verifier = randomString()
        const pending: Pending = {state: randomString(), verifier, returnTo: opts?.returnTo}
        sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
        const url = new URL(meta.authorization_endpoint)
        url.search = new URLSearchParams({
            response_type: "code",
            client_id: this.config.clientId,
            redirect_uri: this.config.redirectUri,
            state: pending.state,
            code_challenge: await s256(verifier),
            code_challenge_method: "S256",
            resource: this.config.resource ?? meta.issuer,
            ...(this.config.scope ? {scope: this.config.scope} : {}),
        }).toString()
        window.location.assign(url.href)
        await new Promise(() => undefined)
    }

    public isCallback = (href: string): boolean => {
        const url = new URL(href)
        return url.origin + url.pathname === new URL(this.config.redirectUri).href.replace(/[?#].*$/, "")
            && (url.searchParams.has("code") || url.searchParams.has("error"))
    }

    public handleCallback = async (href: string): Promise<{result: GGOAuthResult<I>, returnTo?: string}> => {
        const params = new URL(href).searchParams
        const raw = sessionStorage.getItem(PENDING_KEY)
        sessionStorage.removeItem(PENDING_KEY)
        const pending = raw ? JSON.parse(raw) as Pending : undefined
        if (!pending || params.get("state") !== pending.state) throw new NOT_AUTHORIZED({debugMessage: "OAuth state mismatch"})
        // RFC 9207: reject a response from a different authorization server (mix-up attack).
        const iss = params.get("iss")
        if (iss !== null && iss !== (await this.discover()).issuer) throw new NOT_AUTHORIZED({debugMessage: "OAuth issuer mismatch"})
        const error = params.get("error")
        if (error) throw new NOT_AUTHORIZED({debugMessage: `OAuth ${error}: ${params.get("error_description") ?? ""}`})
        const result = await this.token({
            grant_type: "authorization_code",
            code: params.get("code") ?? "",
            redirect_uri: this.config.redirectUri,
            code_verifier: pending.verifier,
        })
        return {result, returnTo: pending.returnTo}
    }

    public refresh = async ({refreshToken}: {refreshToken: string}): Promise<GGOAuthResult<I>> =>
        this.token({grant_type: "refresh_token", refresh_token: refreshToken})

    // Revokes the refresh token and ends the authorization server's login session (redirects away).
    public logout = async (refreshToken: string | undefined): Promise<void> => {
        this.leaving = true
        const meta = await this.discover()
        if (refreshToken && meta.revocation_endpoint) {
            await fetch(meta.revocation_endpoint, {method: "POST", body: new URLSearchParams({token: refreshToken, client_id: this.config.clientId})}).catch(() => undefined)
        }
        if (!meta.end_session_endpoint) {
            this.leaving = false
            return
        }
        const url = new URL(meta.end_session_endpoint)
        url.search = new URLSearchParams({
            client_id: this.config.clientId,
            ...(this.config.postLogoutRedirectUri ? {post_logout_redirect_uri: this.config.postLogoutRedirectUri} : {}),
        }).toString()
        window.location.assign(url.href)
        await new Promise(() => undefined)
    }

    private async token(body: Record<string, string>): Promise<GGOAuthResult<I>> {
        const meta = await this.discover()
        const res = await fetch(meta.token_endpoint, {
            method: "POST",
            body: new URLSearchParams({...body, client_id: this.config.clientId, resource: this.config.resource ?? meta.issuer}),
        })
        const json = await res.json().catch(() => ({})) as Record<string, unknown>
        if (!res.ok) {
            // invalid_grant = the refresh/code is dead → fatal for the session; anything else may be transient.
            if (res.status === 400 || res.status === 401) throw new NOT_AUTHORIZED({debugMessage: `OAuth ${String(json.error)}`})
            throw new Error(`OAuth token endpoint ${res.status}`)
        }
        const now = Date.now()
        const access = String(json.access_token)
        return {
            tokens: {
                access: {token: access, expiresAt: now + Number(json.expires_in) * 1000},
                ...(json.refresh_token ? {refresh: {token: String(json.refresh_token), expiresAt: now + (this.config.refreshTtlMs ?? 30 * 24 * 3600 * 1000)}} : {}),
            },
            data: this.config.identity(access),
        }
    }

    private discover(): Promise<Metadata> {
        this.metadata ??= fetch(`${this.config.server}/.well-known/oauth-authorization-server`).then(async res => {
            if (!res.ok) throw new Error(`OAuth discovery failed: ${res.status}`)
            return await res.json() as Metadata
        })
        this.metadata.catch(() => { this.metadata = undefined })
        return this.metadata
    }
}

// A grest-ts access token's payload, unverified — for UI identity only; the server re-verifies
// every request.
export function decodeAccessToken<T>(accessToken: string): {sub: string, exp: number, data: T} {
    return decodeJwt(accessToken) as unknown as {sub: string, exp: number, data: T}
}

function randomString(): string {
    return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

async function s256(verifier: string): Promise<string> {
    return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))
}

function base64url(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
