import {createHash, randomBytes} from "node:crypto"

// An error response from the token endpoint (RFC 6749 §5.2), e.g. `invalid_grant`.
export class GGOAuthTokenError extends Error {
    public readonly error: string
    public readonly status: number

    constructor(error: string, status: number, description?: string) {
        super(`${error}${description ? `: ${description}` : ""}`)
        this.error = error
        this.status = status
    }
}

export interface GGOAuthHeadlessBrowserOptions {
    // An origin the authorization server is reached on: its issuer, or another of its hosts.
    server: string
    // Other origins whose redirects are followed (e.g. the host an external sign-in starts on).
    origins?: string[]
    fetch?: typeof fetch
}

export interface GGOAuthHeadlessClient {
    clientId: string
    // Registered for the client: the flow ends with a redirect there.
    redirectUri: string
    scope?: string
    resource?: string
    // More authorization parameters (prompt, the server's extraParams).
    params?: Record<string, string>
}

export interface GGOAuthHeadlessStep {
    // The last URL fetched.
    url: URL
    status: number
    html: string
    // Set when a redirect left the server's origins: the client's redirect URI, or an upstream sign-in.
    location?: URL
    // Set when `url` is one of the flow's sign-in pages.
    uid?: string
}

// What the caller does on a sign-in page: POST `form` to /oauth/interaction/:uid/`action`.
export interface GGOAuthPageAnswer {
    action: string
    form?: Record<string, string>
}

export interface GGOAuthHeadlessTokens {
    accessToken: string
    refreshToken?: string
    idToken?: string
    // Epoch ms.
    expiresAt: number
}

type Metadata = {issuer: string, authorization_endpoint: string, token_endpoint: string}

const MAX_HOPS = 20
const MAX_PAGES = 10

// Signs in to a GGOAuthServer as a browser would, without one (scripts, tests): a cookie jar (by name only, one
// server at a time), redirects followed by hand, self-submitting forms submitted, form POSTs with the issuer's
// Origin. It stops on the app's sign-in pages and lets the caller answer them.
export class GGOAuthHeadlessBrowser {

    readonly cookies = new Map<string, string>()
    // The redirect URIs of flows started here: the flow ends there even on one of the server's origins.
    private readonly redirectUris = new Set<string>()
    private metadata: Promise<Metadata> | undefined
    private readonly options: GGOAuthHeadlessBrowserOptions
    private readonly fetch: typeof fetch

    constructor(options: GGOAuthHeadlessBrowserOptions) {
        this.options = options
        this.fetch = options.fetch ?? fetch
    }

    // The authorization request (PKCE S256), followed to the first sign-in page or out of the server.
    // `finish` redeems the code the flow ends with at the client's redirect URI.
    public authorize = async (client: GGOAuthHeadlessClient): Promise<{step: GGOAuthHeadlessStep, finish: (location: URL) => Promise<GGOAuthHeadlessTokens>}> => {
        const meta = await this.discover()
        const verifier = randomBytes(32).toString("base64url")
        this.redirectUris.add(withoutQuery(new URL(client.redirectUri)))
        const url = new URL(meta.authorization_endpoint)
        url.search = new URLSearchParams({
            ...client.params,
            response_type: "code",
            client_id: client.clientId,
            redirect_uri: client.redirectUri,
            state: randomBytes(16).toString("base64url"),
            code_challenge: createHash("sha256").update(verifier).digest("base64url"),
            code_challenge_method: "S256",
            ...(client.scope ? {scope: client.scope} : {}),
            ...(client.resource ? {resource: client.resource} : {}),
        }).toString()
        return {step: await this.follow(url.href), finish: (location) => this.finish(client, verifier, location)}
    }

    // The whole flow: `answer` handles every sign-in page until the flow reaches the client's redirect URI.
    public signIn = async (client: GGOAuthHeadlessClient, answer: (page: GGOAuthHeadlessStep) => GGOAuthPageAnswer | Promise<GGOAuthPageAnswer>): Promise<GGOAuthHeadlessTokens> => {
        const flow = await this.authorize(client)
        let step = flow.step
        for (let pages = 0; !step.location; pages++) {
            if (!step.uid || step.status !== 200 || pages === MAX_PAGES) throw new Error(`Headless sign-in: ${step.status} at ${step.url.href}: ${step.html.slice(0, 300)}`)
            const {action, form} = await answer(step)
            step = await this.submit(step, action, form)
        }
        return flow.finish(step.location)
    }

    // Answers a sign-in page and follows where it leads.
    public submit = async (page: {url: URL, uid?: string}, action: string, form: Record<string, string> = {}): Promise<GGOAuthHeadlessStep> => {
        const url = `${page.url.origin}/oauth/interaction/${page.uid}/${action}`
        return this.follow(url, this.post(url, form))
    }

    // Follows redirects and self-submitting forms while they stay on the server's origins. `first`: the
    // response to `url` when already requested (e.g. a POST).
    public follow = async (url: string, first?: Promise<Response>): Promise<GGOAuthHeadlessStep> => {
        const origins = await this.origins()
        let at = new URL(url, this.options.server)
        let res = await (first ?? this.get(at.href))
        for (let hops = 0; hops < MAX_HOPS; hops++) {
            const location = res.headers.get("location")
            if (location && res.status >= 300 && res.status < 400) {
                await res.body?.cancel()
                const next = new URL(location, at)
                if (!origins.includes(next.origin) || this.redirectUris.has(withoutQuery(next))) return {url: at, status: res.status, html: "", location: next}
                at = next
                res = await this.get(at.href)
                continue
            }
            const html = await res.text()
            const form = res.status === 200 && html.includes("document.forms[0].submit()") ? /<form[^>]*action="([^"]+)"/.exec(html) : null
            if (!form) return {url: at, status: res.status, html, uid: /^\/oauth\/interaction\/([\w-]+)$/.exec(at.pathname)?.[1]}
            const fields = Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map(m => [m[1], m[2]]))
            at = new URL(form[1], at)
            res = await this.post(at.href, fields)
        }
        throw new Error(`Headless sign-in: too many redirects at ${at.href}`)
    }

    // A fetch with this browser's cookies that doesn't follow redirects.
    public get = async (url: string, init: RequestInit = {}): Promise<Response> => {
        const cookie: Record<string, string> = this.cookies.size ? {cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ")} : {}
        const res = await this.fetch(new URL(url, this.options.server).href, {...init, redirect: "manual", headers: {...init.headers as Record<string, string>, ...cookie}})
        for (const c of res.headers.getSetCookie()) {
            const kv = c.split(";")[0]
            const eq = kv.indexOf("=")
            if (/;\s*(max-age=0|expires=thu, 01 jan 1970)/i.test(c)) this.cookies.delete(kv.slice(0, eq))
            else this.cookies.set(kv.slice(0, eq), kv.slice(eq + 1))
        }
        return res
    }

    // A form POST as a page on the issuer sends it. `origin`: another Origin header; null sends none.
    public post = async (url: string, form: Record<string, string>, origin?: string | null): Promise<Response> => {
        const sent = origin === undefined ? new URL((await this.discover()).issuer).origin : origin
        return this.get(url, {method: "POST", headers: sent ? {origin: sent} : {}, body: new URLSearchParams(form)})
    }

    public discover = (): Promise<Metadata> => {
        this.metadata ??= (async () => {
            const res = await this.fetch(`${new URL(this.options.server).origin}/.well-known/oauth-authorization-server`)
            if (!res.ok) throw new Error(`Headless sign-in: no authorization server metadata at ${this.options.server} (${res.status})`)
            return await res.json() as Metadata
        })()
        this.metadata.catch(() => { this.metadata = undefined })
        return this.metadata
    }

    private async origins(): Promise<string[]> {
        return [new URL((await this.discover()).issuer).origin, new URL(this.options.server).origin, ...(this.options.origins ?? []).map(o => new URL(o).origin)]
    }

    private async finish(client: GGOAuthHeadlessClient, verifier: string, location: URL): Promise<GGOAuthHeadlessTokens> {
        const meta = await this.discover()
        const params = location.searchParams
        if (withoutQuery(location) !== withoutQuery(new URL(client.redirectUri))) throw new Error(`Headless sign-in: the flow went to ${location.href}`)
        if (params.get("error")) throw new GGOAuthTokenError(params.get("error")!, 400, params.get("error_description") ?? undefined)
        if (params.get("iss") !== meta.issuer) throw new Error(`Headless sign-in: the callback is from ${params.get("iss")}, not ${meta.issuer}`)
        const res = await this.fetch(meta.token_endpoint, {
            method: "POST",
            body: new URLSearchParams({
                grant_type: "authorization_code", code: params.get("code") ?? "", redirect_uri: client.redirectUri,
                client_id: client.clientId, code_verifier: verifier, ...(client.resource ? {resource: client.resource} : {}),
            }),
        })
        const json = await res.json().catch(() => ({})) as {access_token?: string, refresh_token?: string, id_token?: string, expires_in?: number, error?: string, error_description?: string}
        if (!res.ok || !json.access_token) throw new GGOAuthTokenError(json.error ?? "server_error", res.status, json.error_description)
        return {accessToken: json.access_token, refreshToken: json.refresh_token, idToken: json.id_token, expiresAt: Date.now() + (json.expires_in ?? 0) * 1000}
    }
}

const withoutQuery = (url: URL): string => url.origin + url.pathname
