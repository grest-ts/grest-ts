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

export interface CookieAttributes {
    httpOnly?: boolean
    secure?: boolean
    sameSite?: "lax" | "strict" | "none"
    path?: string
    domain?: string
    maxAgeSec?: number
}

type CookieIntent =
    | {op: "set"; value: string; attrs?: CookieAttributes}
    | {op: "clear"; attrs?: CookieAttributes}

const SAFE_DEFAULTS = {httpOnly: true, secure: true, sameSite: "lax", path: "/"} as const

export interface GGCookieConfig {
    cookieName: string
    schema?: GGSchema<string>
    contextName?: string
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

    private readonly inbound: GGContextKey<string>
    private readonly intent: GGContextKey<CookieIntent>

    constructor(config: GGCookieConfig | string) {
        const cfg = typeof config === "string" ? {cookieName: config} : config
        this.cookieName = cfg.cookieName
        const ctxName = cfg.contextName ?? `cookie:${cfg.cookieName}`
        this.inbound = new GGContextKey<string>(ctxName, cfg.schema ?? IsString)
        this.intent = new GGContextKey<CookieIntent>(`${ctxName}:out`, IsAny as unknown as GGSchema<CookieIntent>)
    }

    public get = (): string | undefined => this.inbound.get()

    public issue = (value: string, attrs?: CookieAttributes): void => {
        this.assertCanEmit("issue")
        this.intent.set({op: "set", value, attrs})
    }

    public clear = (attrs?: CookieAttributes): void => {
        this.assertCanEmit("clear")
        this.intent.set({op: "clear", attrs})
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
                this.inbound.set(decodeURIComponent(part.slice(eq + 1).trim()))
                return
            }
        }
    }

    public updateResponse = (res: GGHttpResponse): void => {
        const intent = this.intent.get()
        if (!intent) return
        const line = intent.op === "clear"
            ? this.serialize("", {...intent.attrs, maxAgeSec: 0})
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
        s += `; Path=${a.path}`
        if (a.domain) s += `; Domain=${a.domain}`
        if (a.maxAgeSec !== undefined) s += `; Max-Age=${a.maxAgeSec}`
        s += `; SameSite=${a.sameSite.charAt(0).toUpperCase()}${a.sameSite.slice(1)}`
        if (secure) s += "; Secure"
        if (a.httpOnly) s += "; HttpOnly"
        return s
    }
}
