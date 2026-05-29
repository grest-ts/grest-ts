import {GGContextKey} from "@grest-ts/context"
import {IsString, type GGSchema} from "@grest-ts/schema"
import type {GGHttpRequest, GGHttpTransportMiddleware} from "./GGHttpSchema"

/**
 * Local structural copy of GGWebSocketHandshakeContext (defined in @grest-ts/websocket).
 * http must not import websocket; header()'s WS half is typed against this shape and
 * matches GGWebSocketMiddleware structurally at the webSocketSchema.use() call site.
 * `headers` is the in-band handshake bag (client-set, spoofable — same trust level as an
 * HTTP request header).
 */
interface WsHandshakeContextLike {
    headers: Record<string, string>
    upgradeHeaders?: Record<string, string>
    queryArgs: Record<string, string>
}

export interface GGHeaderBinding extends GGHttpTransportMiddleware {
    parseHandshake(ctx: WsHandshakeContextLike): void
    updateHandshake(ctx: WsHandshakeContextLike): void
}

const BEARER = "Bearer "

/**
 * Bind a context key to a single named header, on both transports. Reads ONLY that header
 * — never a cookie — from the HTTP request (parseRequest) or the in-band WS handshake
 * (parseHandshake) into key.get(), and writes it from key.get() on the client (HTTP
 * updateRequest / WS updateHandshake). `scheme: "bearer"` strips/adds the `Bearer ` prefix;
 * default is verbatim. The wire name defaults to the key's name (lowercased — HTTP headers
 * are case-insensitive). Client-attachable, so it is the service-to-service variant (a
 * Node client can carry it; a browser cookie cannot).
 */
export function header(key: GGContextKey<string | undefined>, opts?: {name?: string; scheme?: "bearer"; schema?: GGSchema<string | undefined>}): GGHeaderBinding {
    const name = (opts?.name ?? key.name).toLowerCase()
    const bearer = opts?.scheme === "bearer"
    const unwrap = (raw: string | undefined): string | undefined => {
        if (raw === undefined) return undefined
        return bearer && raw.startsWith(BEARER) ? raw.slice(BEARER.length) : raw
    }
    const wrap = (value: string): string => bearer ? `${BEARER}${value}` : value
    return {
        headers: {[name]: opts?.schema ?? IsString.orUndefined},
        responseHeaders: {},
        parseRequest(req: GGHttpRequest): void {
            const raw = req.headers?.[name]
            const value = unwrap(typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined)
            if (value !== undefined) key.set(value)
        },
        updateRequest(req: GGHttpRequest): void {
            const value = key.get()
            if (value === undefined) return
            req.headers = req.headers ?? {}
            req.headers[name] = wrap(value)
        },
        parseHandshake(ctx: WsHandshakeContextLike): void {
            const value = unwrap(ctx.headers?.[name])
            if (value !== undefined) key.set(value)
        },
        updateHandshake(ctx: WsHandshakeContextLike): void {
            const value = key.get()
            if (value !== undefined) ctx.headers[name] = wrap(value)
        },
    }
}
