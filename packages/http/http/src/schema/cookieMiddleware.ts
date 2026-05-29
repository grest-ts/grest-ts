import {GGContextKey} from "@grest-ts/context"
import {IsAny, IsString, SERVER_ERROR, type GGSchema} from "@grest-ts/schema"
import type {GGHttpRequest, GGHttpResponse, GGHttpTransportMiddleware} from "./GGHttpSchema"

/**
 * Per-request set of context-key names the current route is permitted to write a cookie
 * for (declared via GGRpc.*(...).updatesCookie(key)). Populated by the server route
 * handler; read by setCookie() to reject undeclared cookie writes.
 */
export const GG_COOKIE_WRITES = new GGContextKey<Set<string>>("cookie:writes", IsAny as unknown as GGSchema<Set<string>>)

/**
 * Cookie write rules — passed to setCookie(key, value, options). They live at the write
 * call site (the handler that mints the cookie), never in the shared API.
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

interface PendingCookie {
    value: string | undefined
    options?: CookieOptions
}

/**
 * Per-request Set-Cookie writes scheduled via setCookie()/clearCookie(), keyed by the
 * context key's name. Flushed onto the response by the matching cookie() binding.
 */
const GG_COOKIE_PENDING = new GGContextKey<Map<string, PendingCookie>>("cookie:pending", IsAny as unknown as GGSchema<Map<string, PendingCookie>>)

// Reject anything that could break out of the Set-Cookie line / inject attributes.
function assertCookieSafe(label: string, value: string): void {
    if (/[\x00-\x1f;]/.test(value)) {
        throw new Error(`Cookie ${label} contains illegal characters (control chars or ';'): ${JSON.stringify(value)}`)
    }
}

/**
 * Read a single named cookie out of a raw `Cookie` header value. Shared by the HTTP
 * binding (parseRequest) and the WebSocket binding (parseHandshake). A malformed
 * percent-encoding (e.g. "sid=%") must not crash — fall back to the raw value.
 */
export function readCookie(rawCookieHeader: string | undefined, name: string): string | undefined {
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

function serializeSetCookie(name: string, value: string | undefined, options?: CookieOptions): string {
    const o = {...SAFE_DEFAULTS, ...options}
    const secure = o.sameSite === "none" ? true : o.secure
    const sameSite = `${o.sameSite.charAt(0).toUpperCase()}${o.sameSite.slice(1)}`
    const attrs = `; Path=${o.path}${o.domain ? `; Domain=${o.domain}` : ""}; SameSite=${sameSite}${secure ? "; Secure" : ""}${o.httpOnly ? "; HttpOnly" : ""}`
    return value
        ? `${name}=${encodeURIComponent(value)}${o.maxAgeSec !== undefined ? `; Max-Age=${Math.trunc(o.maxAgeSec)}` : ""}${attrs}`
        : `${name}=; Max-Age=0${attrs}`
}

/**
 * Local structural copy of GGWebSocketHandshakeContext (defined in @grest-ts/websocket).
 * http must not import websocket; cookie()'s WS half is typed against this shape and
 * matches GGWebSocketMiddleware structurally at the webSocketSchema.use() call site.
 * `upgradeHeaders` is the real browser upgrade request (carries httpOnly cookies); the
 * in-band `headers` map cannot spoof it.
 */
interface WsHandshakeContextLike {
    headers: Record<string, string>
    upgradeHeaders?: Record<string, string>
    queryArgs: Record<string, string>
}

export interface GGCookieBinding extends GGHttpTransportMiddleware {
    /** The cookie this binding reads, mapped to its value schema — emitted as an `in: cookie` doc param. */
    readonly cookieParams: Record<string, GGSchema<string | undefined>>
    parseHandshake(ctx: WsHandshakeContextLike): void
}

/**
 * Bind a context key to a cookie, read-only on the wire. Reads ONLY the named cookie —
 * never a header — from the incoming HTTP Cookie (parseRequest) or the real WS upgrade
 * Cookie (parseHandshake), into key.get(). The cookie's wire name defaults to the key's
 * name. To write the cookie, call setCookie(key, …) from a route that declared
 * .updatesCookie(key); the matching binding flushes it as Set-Cookie (HTTP only — a
 * WebSocket has no response to set a cookie on).
 */
export function cookie(key: GGContextKey<string | undefined>, opts?: {name?: string; schema?: GGSchema<string | undefined>}): GGCookieBinding {
    const cookieName = opts?.name ?? key.name
    assertCookieSafe("name", cookieName)
    return {
        headers: {},
        responseHeaders: {},
        cookieParams: {[cookieName]: opts?.schema ?? IsString.orUndefined},
        parseRequest(req: GGHttpRequest): void {
            const raw = req.headers?.["cookie"]
            const value = readCookie(typeof raw === "string" ? raw : undefined, cookieName)
            if (value !== undefined) key.set(value)
        },
        updateResponse(res: GGHttpResponse): void {
            const pending = GG_COOKIE_PENDING.get()?.get(key.name)
            if (pending === undefined) return
            const line = serializeSetCookie(cookieName, pending.value, pending.options)
            const existing = res.headers["set-cookie"]
            const arr = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing]
            arr.push(line)
            res.headers["set-cookie"] = arr
        },
        parseHandshake(ctx: WsHandshakeContextLike): void {
            const value = readCookie(ctx.upgradeHeaders?.["cookie"], cookieName)
            if (value !== undefined) key.set(value)
        },
    }
}

/**
 * Schedule a Set-Cookie on the response (HTTP only). The value never touches key.get() —
 * inbound reads stay set-once. The route must declare .updatesCookie(key); an undeclared
 * call is invalid usage and throws SERVER_ERROR. The matching cookie() binding serializes
 * the pending write with these options (HttpOnly/Secure/SameSite/Path/Domain/Max-Age).
 */
export function setCookie(key: GGContextKey<string | undefined>, value: string | undefined, options?: CookieOptions): void {
    if (options) {
        if (options.maxAgeSec !== undefined && !Number.isFinite(options.maxAgeSec)) {
            throw new Error(`setCookie("${key.name}"): maxAgeSec must be a finite number, got ${options.maxAgeSec}.`)
        }
        if (options.path !== undefined) assertCookieSafe("path", options.path)
        if (options.domain !== undefined) assertCookieSafe("domain", options.domain)
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
export function clearCookie(key: GGContextKey<string | undefined>, options?: CookieOptions): void {
    setCookie(key, undefined, options)
}
