import {GGContextKey} from "@grest-ts/context"
import {IsAny, SERVER_ERROR, type GGSchema} from "@grest-ts/schema"
import type {GGHttpRequest, GGHttpResponse, GGHttpTransportMiddleware} from "./GGHttpSchema"

/**
 * Per-request set of context-key names the current route is permitted to modify
 * (declared via GGRpc.*(...).updatesCookie(key)). Populated by the server route
 * handler; read by the cookie binding to reject undeclared cookie writes.
 */
export const GG_COOKIE_WRITES = new GGContextKey<Set<string>>("cookie:writes", IsAny as unknown as GGSchema<Set<string>>)

export interface CookieOptions {
    /** Wire name written to Set-Cookie / read from Cookie. Defaults to the context key's name. */
    cookieName?: string
    httpOnly?: boolean
    secure?: boolean
    sameSite?: "lax" | "strict" | "none"
    /** URL path scope. Default "/". */
    path?: string
    /**
     * Domain scope. Default undefined = host-only (sent only to the exact host that set it).
     * A parent domain (".example.com") sends the cookie to EVERY subdomain — only set this
     * when all subdomains are trusted, since any of them can then read it.
     */
    domain?: string
    maxAgeSec?: number
}

const SAFE_DEFAULTS = {httpOnly: true, secure: true, sameSite: "lax", path: "/"} as const

// Reject anything that could break out of the Set-Cookie line / inject attributes.
function assertCookieSafe(label: string, value: string): void {
    if (/[\x00-\x1f;]/.test(value)) {
        throw new Error(`Cookie ${label} contains illegal characters (control chars or ';'): ${JSON.stringify(value)}`)
    }
}

/**
 * Binds a context key to an httpOnly cookie. parseRequest reads the incoming Cookie
 * into the key (so handlers read it via key.get()); updateResponse emits Set-Cookie
 * only when a handler CHANGED the key versus what arrived — key.set(token) → Set-Cookie,
 * key.set("" | undefined) / key.delete() → Max-Age=0 clear, untouched → nothing.
 *
 * Browser-safe (string ops only). Wire it via httpSchema(...).useCookie(key, options);
 * the key itself is a standard GGContextKey used everywhere with .get()/.set().
 */
export function createCookieMiddleware(
    key: GGContextKey<string | undefined>,
    options: CookieOptions = {}
): GGHttpTransportMiddleware {
    const cookieName = options.cookieName ?? key.name
    const a = {...SAFE_DEFAULTS, ...options}
    assertCookieSafe("name", cookieName)
    assertCookieSafe("path", a.path)
    if (a.domain !== undefined) assertCookieSafe("domain", a.domain)
    if (a.maxAgeSec !== undefined && !Number.isFinite(a.maxAgeSec)) {
        throw new Error(`Cookie "${cookieName}": maxAgeSec must be a finite number, got ${a.maxAgeSec}.`)
    }
    const secure = a.sameSite === "none" ? true : a.secure
    const sameSite = `${a.sameSite.charAt(0).toUpperCase()}${a.sameSite.slice(1)}`
    // Snapshot of what arrived, so updateResponse only emits when the handler changed it.
    const inbound = new GGContextKey<string | undefined>(`${key.name}:cookie-inbound`, IsAny as unknown as GGSchema<string | undefined>)

    const attributes = (): string => {
        let s = `; Path=${a.path}`
        if (a.domain) s += `; Domain=${a.domain}`
        s += `; SameSite=${sameSite}`
        if (secure) s += "; Secure"
        if (a.httpOnly) s += "; HttpOnly"
        return s
    }

    return {
        headers: {},
        responseHeaders: {},

        parseRequest(req: GGHttpRequest): void {
            const raw = req.headers?.["cookie"]
            if (typeof raw !== "string") return
            for (const part of raw.split(";")) {
                const eq = part.indexOf("=")
                if (eq === -1) continue
                if (part.slice(0, eq).trim() === cookieName) {
                    const rawValue = part.slice(eq + 1).trim()
                    // A malformed percent-encoding (e.g. "sid=%") must not crash the request.
                    let value: string
                    try {
                        value = decodeURIComponent(rawValue)
                    } catch {
                        value = rawValue
                    }
                    inbound.set(value)
                    key.set(value)
                    return
                }
            }
        },

        updateResponse(res: GGHttpResponse): void {
            const current = key.get()
            const arrived = inbound.get()
            if (current === arrived) return // handler did not change the cookie
            if (!GG_COOKIE_WRITES.get()?.has(key.name)) {
                key.set(arrived) // reject the change so the error response (catch-path retry) doesn't re-trigger
                throw new SERVER_ERROR({debugMessage: `Cookie "${cookieName}" (context key "${key.name}") was modified by the handler, but this route did not declare .updatesCookie(<key>). Only routes that declare it may set or clear the cookie.`})
            }
            const line = current
                ? `${cookieName}=${encodeURIComponent(current)}${a.maxAgeSec !== undefined ? `; Max-Age=${Math.trunc(a.maxAgeSec)}` : ""}${attributes()}`
                : `${cookieName}=; Max-Age=0${attributes()}`
            const existing = res.headers["set-cookie"]
            const arr = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing]
            arr.push(line)
            res.headers["set-cookie"] = arr
        },
    }
}
