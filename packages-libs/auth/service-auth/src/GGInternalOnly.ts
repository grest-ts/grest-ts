import type {GGTransportMiddleware} from "@grest-ts/context"
import {NOT_AUTHORIZED} from "@grest-ts/schema"

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])
const INTERNAL = /^[a-z0-9-]+\.internal\./

/**
 * First in an internal schema's `use`: refuses a request unless it came to loopback or to an internal host name
 * (`<service>.internal.<domain>`), the names only the load balancer's internal rules forward. Defence in depth; the
 * schema's own credential stays the real gate.
 */
export const GGInternalOnly: GGTransportMiddleware = {
    parse: (inbound) => {
        const host = (inbound.headers.host ?? "").toLowerCase().replace(/:\d+$/, "")
        if (!LOOPBACK.has(host) && !INTERNAL.test(host)) throw new NOT_AUTHORIZED({debugMessage: `Not an internal host: ${host}`})
    },
}
