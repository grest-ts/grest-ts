import {GGContextKey} from "@grest-ts/context"
import {GGSchema, IsAny, IsString, SERVER_ERROR} from "@grest-ts/schema"
import {isBrowser} from "@grest-ts/common"
import type {GGHttpRequest, GGHttpResponse, GGHttpTransportMiddleware} from "./GGHttpSchema"

/**
 * Wire-name set of cookies the current route declared via .setsCookies(...).
 * Populated per request by the server route handler; read by GGCookie to gate
 * issue()/clear(). Internal — defined here so it stays browser-safe and the
 * server handler and GGCookie share one slot.
 */
export const GG_DECLARED_COOKIES = new GGContextKey<Set<string>>("cookie:declared", IsAny as unknown as GGSchema<Set<string>>)

/**
 * Per-mint policy passed to issue(). Path/Domain are NOT here — they are the
 * cookie's scope/identity (a cookie is keyed by name+path+domain) and live on
 * the GGCookie definition so clear() deletes exactly what issue() set.
 */
export interface CookieAttributes {
    httpOnly?: boolean
    secure?: boolean
    sameSite?: "lax" | "strict" | "none"
    maxAgeSec?: number
}

type CookieIntent =
    | {op: "set"; value: string; attrs?: CookieAttributes}
    | {op: "clear"}

const SAFE_DEFAULTS = {httpOnly: true, secure: true, sameSite: "lax"} as const

export interface GGCookieConfig {
    cookieName: string
    /** URL path scope. Default "/". Part of the cookie's identity; clear() reuses it. */
    path?: string
    /**
     * Domain scope. Default undefined = host-only (sent only to the exact host that set it).
     * A parent domain (e.g. ".example.com") sends the cookie to EVERY subdomain — only set
     * this when all subdomains are trusted, since any of them can then read the cookie.
     */
    domain?: string
    schema?: GGSchema<string>
    contextName?: string
}

// Reject anything that could break out of the Set-Cookie line / inject attributes.
function assertCookieSafe(label: string, value: string): void {
    if (/[\x00-\x1f;]/.test(value)) {
        throw new Error(`GGCookie ${label} contains illegal characters (control chars or ';'): ${JSON.stringify(value)}`)
    }
}

/**
 * A server-minted, browser-stored credential carried over HTTP. Browser-safe
 * (string ops only) so it can sit in the shared API definition; issue()/clear()
 * are server-only and throw if reached in the browser. Wire it with .use(cookie)
 * to parse the incoming Cookie into context; read via .get() anywhere in the
 * request; mint via .issue()/.clear() from a handler whose route declared it.
 */
export class GGCookie implements GGHttpTransportMiddleware {

    public readonly cookieName: string
    public readonly headers: Record<string, GGSchema<string | undefined>> = {}
    public readonly responseHeaders: Record<string, GGSchema<string | undefined>> = {}

    private readonly path: string
    private readonly domain?: string
    private readonly inbound: GGContextKey<string>
    private readonly intent: GGContextKey<CookieIntent>

    constructor(config: GGCookieConfig | string) {
        const cfg = typeof config === "string" ? {cookieName: config} : config
        this.cookieName = cfg.cookieName
        this.path = cfg.path ?? "/"
        this.domain = cfg.domain
        assertCookieSafe("name", this.cookieName)
        assertCookieSafe("path", this.path)
        if (this.domain !== undefined) assertCookieSafe("domain", this.domain)
        const ctxName = cfg.contextName ?? `cookie:${cfg.cookieName}`
        this.inbound = new GGContextKey<string>(ctxName, cfg.schema ?? IsString)
        this.intent = new GGContextKey<CookieIntent>(`${ctxName}:out`, IsAny as unknown as GGSchema<CookieIntent>)
    }

    public get = (): string | undefined => this.inbound.get()

    public issue = (value: string, attrs?: CookieAttributes): void => {
        this.assertCanEmit("issue")
        if (attrs?.maxAgeSec !== undefined && !Number.isFinite(attrs.maxAgeSec)) {
            throw new Error(`GGCookie("${this.cookieName}").issue(): maxAgeSec must be a finite number, got ${attrs.maxAgeSec}.`)
        }
        this.intent.set({op: "set", value, attrs})
    }

    public clear = (): void => {
        this.assertCanEmit("clear")
        this.intent.set({op: "clear"})
    }

    private assertCanEmit(method: "issue" | "clear"): void {
        if (isBrowser()) throw new Error(`GGCookie("${this.cookieName}").${method}() is server-only — cookies are minted by the server, not the browser.`)
        if (!GG_DECLARED_COOKIES.get()?.has(this.cookieName)) {
            throw new SERVER_ERROR({debugMessage: `GGCookie("${this.cookieName}").${method}() was called, but the current route did not declare this cookie. Add .setsCookies(<cookie>) to the route's GGRpc binding so the server is permitted to emit Set-Cookie.`})
        }
    }

    public parseRequest = (req: GGHttpRequest): void => {
        const raw = req.headers?.["cookie"]
        if (typeof raw !== "string") return
        for (const part of raw.split(";")) {
            const eq = part.indexOf("=")
            if (eq === -1) continue
            if (part.slice(0, eq).trim() === this.cookieName) {
                const rawValue = part.slice(eq + 1).trim()
                // A malformed percent-encoding (e.g. "sid=%") must not crash the request —
                // fall back to the raw value rather than letting decodeURIComponent throw.
                let value: string
                try {
                    value = decodeURIComponent(rawValue)
                } catch {
                    value = rawValue
                }
                this.inbound.set(value)
                return
            }
        }
    }

    public updateResponse = (res: GGHttpResponse): void => {
        const intent = this.intent.get()
        if (!intent) return
        const line = intent.op === "clear"
            ? this.serialize("", {maxAgeSec: 0})
            : this.serialize(intent.value, intent.attrs)
        const existing = res.headers["set-cookie"]
        const arr = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing]
        arr.push(line)
        res.headers["set-cookie"] = arr
    }

    private serialize(value: string, attrs?: CookieAttributes): string {
        const a = {...SAFE_DEFAULTS, ...attrs}
        const secure = a.sameSite === "none" ? true : a.secure
        let s = `${this.cookieName}=${encodeURIComponent(value)}`
        s += `; Path=${this.path}`
        if (this.domain) s += `; Domain=${this.domain}`
        if (a.maxAgeSec !== undefined) s += `; Max-Age=${Math.trunc(a.maxAgeSec)}`
        s += `; SameSite=${a.sameSite.charAt(0).toUpperCase()}${a.sameSite.slice(1)}`
        if (secure) s += "; Secure"
        if (a.httpOnly) s += "; HttpOnly"
        return s
    }
}
