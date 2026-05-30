import {GGContextKey, type GGInbound, type GGOutbound, type GGTransportMiddleware} from "@grest-ts/context"
import {IsString, type GGSchema} from "@grest-ts/schema"

const BEARER = "Bearer "

export class GGHeader {

    public static middleware(key: GGContextKey<string | undefined>, opts?: {name?: string; scheme?: "bearer"; schema?: GGSchema<string | undefined>}): GGTransportMiddleware {
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
            parse(inbound: GGInbound): void {
                const value = unwrap(inbound.headers[name])
                if (value !== undefined) key.set(value)
            },
            update(outbound: GGOutbound): void {
                const value = key.get()
                if (value !== undefined) outbound.headers[name] = wrap(value)
            },
        }
    }
}
