import {GGContextKey, type GGInbound, type GGOutbound} from "@grest-ts/context"
import {IsString, type GGSchema} from "@grest-ts/schema"

/**
 * Shared-secret header used on the internal notify channel between work
 * servers (hub-server) and socket-server. Transported as X-Internal-Token.
 *
 * The socket-server validates the token against its configured secret;
 * the hub-server client sets it from the same shared config value.
 * Not exposed on any public route — /internal/notify/* is VPC-internal
 * in prod and localhost-only in dev.
 */
const IsInternalToken = IsString.brand("InternalToken")
type tInternalToken = typeof IsInternalToken.infer

class InternalTokenTransport extends GGContextKey<tInternalToken> {
    readonly headers: Record<string, GGSchema<string | undefined>> = {"x-internal-token": IsString.orUndefined}
    readonly responseHeaders: Record<string, GGSchema<string | undefined>> = {}

    update(outbound: GGOutbound): void {
        const token = GG_INTERNAL_TOKEN.get()
        if (token) {
            outbound.headers["x-internal-token"] = token
        }
    }

    parse(inbound: GGInbound): void {
        const header = inbound.headers["x-internal-token"]
        if (header) {
            GG_INTERNAL_TOKEN.set(header as tInternalToken)
        }
    }
}

export const GG_INTERNAL_TOKEN = new InternalTokenTransport("internalToken", IsInternalToken)
