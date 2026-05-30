import {GGContextKey} from "@grest-ts/context"
import {IsString, type GGSchema} from "@grest-ts/schema"
import type {GGHttpRequest, GGHttpTransportMiddleware} from "./GGHttpSchema"

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

export class GGHeader {

    public static middleware(key: GGContextKey<string | undefined>, opts?: {name?: string; scheme?: "bearer"; schema?: GGSchema<string | undefined>}): GGHeaderBinding {
        const name = (opts?.name ?? key.name).toLowerCase()
        const bearer = opts?.scheme === "bearer"
        const unwrap = (raw: string | undefined): string | undefined => {
            if (raw === undefined) return undefined
            return bearer && raw.startsWith(BEARER) ? raw.slice(BEARER.length) : raw
        }
        const wrap = (value: string): string => bearer ? `${BEARER}${value}` : value
        return {
            key,
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
}
