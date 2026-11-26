import type {GGTransportMiddleware} from "@grest-ts/context"
import {NOT_AUTHORIZED} from "@grest-ts/schema"

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])
const INTERNAL = /^[a-z0-9-]+\.internal\./

/**
 * First in an internal schema's `use`: refuses a request unless its `Host` is loopback or `<label>.internal.<anything>`.
 * The `Host`, not the peer address (`GG_LOOPBACK`): behind a local reverse proxy every peer is loopback.
 */
export const GGInternalOnly: GGTransportMiddleware = {
    parse: (inbound) => {
        const host = (inbound.headers.host ?? "").toLowerCase().replace(/:\d+$/, "")
        if (!LOOPBACK.has(host) && !INTERNAL.test(host)) throw new NOT_AUTHORIZED({debugMessage: `Not an internal host: ${host}`})
    },
}
