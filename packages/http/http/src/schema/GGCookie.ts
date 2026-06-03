import {GGContextKey, type GGInbound, type GGResponse} from "@grest-ts/context"
import {type GGSchema, IsAny, IsString, SERVER_ERROR} from "@grest-ts/schema"
import {GGWireContextKey} from "./GGWireContextKey"

/**
 * Per-request set of context-key names the current route is permitted to write a cookie
 * for (declared via GGRpc.*(...).updatesCookie(key)). Populated by the server route
 * handler; read by setCookie() to reject undeclared cookie writes.
 */
export const GG_COOKIE_WRITES = new GGContextKey<Set<string>>("cookie:writes", IsAny as unknown as GGSchema<Set<string>>)

/**
 * Per-request Set-Cookie writes scheduled via setCookie()/clearCookie(), keyed by the
 * context key's name. Flushed onto the response by the matching cookie() binding.
 */
const GG_COOKIE_PENDING = new GGContextKey<Map<string, PendingCookie>>("cookie:pending", IsAny as unknown as GGSchema<Map<string, PendingCookie>>)

export interface CookieOptions {
    httpOnly?: boolean
    secure?: boolean
    sameSite?: "lax" | "strict" | "none"
    path?: string
    domain?: string
    maxAgeSec?: number
}

const SAFE_DEFAULTS: CookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/"
} as const

interface PendingCookie {
    value: string | undefined
    options?: CookieOptions
}

/**
 * A cookie that IS its own context key.
 *
 *   // ambient — the named cookie's value lands in the wire and persists, no implementation needed.
 *   const SESSION_WIRE = new GGCookie("session_id")
 *
 * Reads ONLY the named cookie — never a header — from the inbound Cookie header into the wire.
 * For HTTP that is the request Cookie; for WebSocket the real upgrade Cookie (the runtime fills
 * inbound.cookie from there, never from the spoofable in-band message). The cookie name is the
 * first constructor argument (case-sensitive — unlike a header it is not lowercased). To write
 * the cookie, call GGCookie.setCookie(key, …) from a route that declared .updatesCookie(key);
 * this wire flushes it as Set-Cookie (HTTP only — a WebSocket has no response to set a cookie on).
 */
export class GGCookie extends GGWireContextKey {

    public readonly cookieParams: Record<string, GGSchema<string | undefined>>

    constructor(name: string) {
        const WIRE_SCHEMA = IsString.orUndefined
        super(name, WIRE_SCHEMA)
        _assertCookieSafe("name", this.name)
        this.cookieParams = {[this.name]: WIRE_SCHEMA}
    }

    public parse(inbound: GGInbound): void {
        const value = _readCookie(inbound.cookie, this.name)
        if (value !== undefined) this.set(value)
    }

    public respond(res: GGResponse): void {
        const pending = GG_COOKIE_PENDING.get()?.get(this.name)
        if (pending === undefined) return
        const line = _serializeSetCookie(this.name, pending.value, pending.options)
        const existing = res.headers["set-cookie"]
        const arr = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing]
        arr.push(line)
        res.headers["set-cookie"] = arr
    }

    /**
     * Schedule a Set-Cookie on the response (HTTP only). The value never touches key.get() —
     * inbound reads stay set-once. The route must declare .updatesCookie(key); an undeclared
     * call is invalid usage and throws SERVER_ERROR. The matching cookie() binding serializes
     * the pending write with these options (HttpOnly/Secure/SameSite/Path/Domain/Max-Age).
     */
    public static setCookie(key: GGContextKey<string | undefined>, value: string | undefined, options?: CookieOptions): void {
        if (options) {
            if (options.maxAgeSec !== undefined && !Number.isFinite(options.maxAgeSec)) {
                throw new Error(`setCookie("${key.name}"): maxAgeSec must be a finite number, got ${options.maxAgeSec}.`)
            }
            if (options.path !== undefined) _assertCookieSafe("path", options.path)
            if (options.domain !== undefined) _assertCookieSafe("domain", options.domain)
        }
        if (!GG_COOKIE_WRITES.get()?.has(key.name)) {
            throw new SERVER_ERROR({debugMessage: `setCookie("${key.name}") was called, but this route did not declare .updatesCookie(<key>). Only routes that declare it may set or clear the cookie.`})
        }
        let pending = GG_COOKIE_PENDING.get()
        if (pending === undefined) {
            pending = new Map()
            GG_COOKIE_PENDING.set(pending)
        }
        pending.set(key.name, {value, options})
    }

    /**
     * Clear the cookie — schedules a Set-Cookie with Max-Age=0. Pass path/domain to match a
     * scoped cookie (deletion only works when path+domain match what was set). Equivalent to
     * setCookie(key, undefined, options), but reads clearer at logout-style call sites.
     */
    public static clearCookie(key: GGContextKey<string | undefined>, options?: CookieOptions): void {
        this.setCookie(key, undefined, options)
    }

}


// Reject anything that could break out of the Set-Cookie line / inject attributes.
function _assertCookieSafe(label: string, value: string): void {
    if (/[\x00-\x1f;]/.test(value)) {
        throw new Error(`Cookie ${label} contains illegal characters (control chars or ';'): ${JSON.stringify(value)}`)
    }
}

/**
 * Read a single named cookie out of a raw `Cookie` header value. A malformed
 * percent-encoding (e.g. "sid=%") must not crash — fall back to the raw value.
 */
function _readCookie(rawCookieHeader: string | undefined, name: string): string | undefined {
    if (typeof rawCookieHeader !== "string") return undefined
    for (const part of rawCookieHeader.split(";")) {
        const eq = part.indexOf("=")
        if (eq === -1) continue
        if (part.slice(0, eq).trim() === name) {
            const rawValue = part.slice(eq + 1).trim()
            try {
                return decodeURIComponent(rawValue)
            } catch {
                return rawValue
            }
        }
    }
    return undefined
}

function _serializeSetCookie(name: string, value: string | undefined, options?: CookieOptions): string {
    const o = {...SAFE_DEFAULTS, ...options}
    const sameSiteValue = o.sameSite ?? "lax"
    const secure = sameSiteValue === "none" ? true : o.secure
    const sameSite = `${sameSiteValue.charAt(0).toUpperCase()}${sameSiteValue.slice(1)}`
    const attrs = `; Path=${o.path}${o.domain ? `; Domain=${o.domain}` : ""}; SameSite=${sameSite}${secure ? "; Secure" : ""}${o.httpOnly ? "; HttpOnly" : ""}`
    return value
        ? `${name}=${encodeURIComponent(value)}${o.maxAgeSec !== undefined ? `; Max-Age=${Math.trunc(o.maxAgeSec)}` : ""}${attrs}`
        : `${name}=; Max-Age=0${attrs}`
}