import {GGContextKey} from "@grest-ts/context"
import {IsAny, IsString, SERVER_ERROR, type GGSchema} from "@grest-ts/schema"
import type {GGHttpRequest, GGHttpResponse, GGHttpTransportMiddleware} from "./GGHttpSchema"

/**
 * Per-request set of context-key names the current route is permitted to modify
 * (declared via GGRpc.*(...).updatesCookie(key)). Populated by the server route
 * handler; read by the cookie binding to reject undeclared cookie writes.
 */
export const GG_COOKIE_WRITES = new GGContextKey<Set<string>>("cookie:writes", IsAny as unknown as GGSchema<Set<string>>)

/**
 * Cookie write rules — passed to GGContextKeyForCookie.set(value, options). These live at
 * the set site (the server handler that mints the cookie), never in the shared API.
 */
export interface CookieOptions {
    httpOnly?: boolean
    secure?: boolean
    sameSite?: "lax" | "strict" | "none"
    path?: string
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
 * A context key whose value is carried as an httpOnly cookie. It IS a GGContextKey —
 * read with .get(), and the cookie's wire name is the key's name. The only addition is
 * that .set(value, options) takes per-write cookie rules (HttpOnly/Secure/SameSite/Path/
 * Domain/Max-Age). Bind it to the wire with httpSchema(...).useCookie(key); a route must
 * declare .updatesCookie(key) to be allowed to change it.
 */
export class GGContextKeyForCookie extends GGContextKey<string | undefined> {

    private readonly _options: GGContextKey<CookieOptions | undefined>

    constructor(name: string) {
        super(name, IsString.orUndefined)
        assertCookieSafe("name", name)
        this._options = new GGContextKey<CookieOptions | undefined>(`${name}:cookie-options`, IsAny as unknown as GGSchema<CookieOptions | undefined>)
    }

    public set(value: string | undefined, options?: CookieOptions): void {
        if (options) {
            if (options.maxAgeSec !== undefined && !Number.isFinite(options.maxAgeSec)) {
                throw new Error(`GGContextKeyForCookie("${this.name}").set(): maxAgeSec must be a finite number, got ${options.maxAgeSec}.`)
            }
            if (options.path !== undefined) assertCookieSafe("path", options.path)
            if (options.domain !== undefined) assertCookieSafe("domain", options.domain)
        }
        super.set(value)
        this._options.set(options)
    }

    /** @internal Read by the cookie binding when emitting Set-Cookie. */
    public _writeOptions(): CookieOptions | undefined {
        return this._options.get()
    }
}

/**
 * Binds a GGContextKeyForCookie to the wire. parseRequest reads the incoming Cookie
 * (named by the key) into the key; updateResponse emits Set-Cookie only when a handler
 * CHANGED the key versus what arrived — set(token) → Set-Cookie, set(undefined)/""/
 * delete() → Max-Age=0 clear, untouched → nothing. Changing a cookie whose route did not
 * declare .updatesCookie(key) is a SERVER_ERROR. Used by httpSchema(...).useCookie(key).
 */
export function createCookieMiddleware(key: GGContextKeyForCookie): GGHttpTransportMiddleware {
    const cookieName = key.name // validated in the key's constructor
    // Snapshot of what arrived, so updateResponse only emits when the handler changed it.
    const inbound = new GGContextKey<string | undefined>(`${key.name}:cookie-inbound`, IsAny as unknown as GGSchema<string | undefined>)

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
                throw new SERVER_ERROR({debugMessage: `Cookie "${cookieName}" was modified by the handler, but this route did not declare .updatesCookie(<key>). Only routes that declare it may set or clear the cookie.`})
            }
            const o = {...SAFE_DEFAULTS, ...key._writeOptions()}
            const secure = o.sameSite === "none" ? true : o.secure
            const sameSite = `${o.sameSite.charAt(0).toUpperCase()}${o.sameSite.slice(1)}`
            const attrs = `; Path=${o.path}${o.domain ? `; Domain=${o.domain}` : ""}; SameSite=${sameSite}${secure ? "; Secure" : ""}${o.httpOnly ? "; HttpOnly" : ""}`
            const line = current
                ? `${cookieName}=${encodeURIComponent(current)}${o.maxAgeSec !== undefined ? `; Max-Age=${Math.trunc(o.maxAgeSec)}` : ""}${attrs}`
                : `${cookieName}=; Max-Age=0${attrs}`
            const existing = res.headers["set-cookie"]
            const arr = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing]
            arr.push(line)
            res.headers["set-cookie"] = arr
        },
    }
}
