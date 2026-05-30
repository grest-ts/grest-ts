import {GGContextKey, type GGInbound, type GGOutbound, type GGTransportMiddleware} from "@grest-ts/context"
import {IsString, type GGSchema} from "@grest-ts/schema"
import {GG_USER_TOKEN, GG_ORG_TOKEN} from "./AuthContext"

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

/**
 * Ferries the user + org auth tokens across the WS handshake. Mirrors the
 * HTTP pattern (`.use(GG_USER_TOKEN).use(GG_ORG_TOKEN)`) but uses the WS
 * handshake headers map instead of HTTP request headers.
 *
 *   Browser  ──update──>  reads GG_USER_TOKEN/GG_ORG_TOKEN from the
 *                          ambient browser context, writes tokens
 *                          into the handshake header map.
 *   Server   ──parse──>    reads the tokens back into GG_USER_TOKEN /
 *                          GG_ORG_TOKEN on the WS connection context.
 *
 * Pure transport — no decryption, no validation. socket-server attaches a
 * separate validation middleware that reads the context tokens, decrypts
 * them via TokenService, and sets the higher-level payload keys.
 */
export class SocketAuthHeaderMiddleware implements GGTransportMiddleware {

    update(outbound: GGOutbound): void {
        const user = GG_USER_TOKEN.get()
        const org = GG_ORG_TOKEN.get()
        if (user) outbound.headers["x-user-token"] = user
        if (org)  outbound.headers["x-org-token"]  = org
    }

    parse(inbound: GGInbound): void {
        const user = inbound.headers["x-user-token"]
        const org = inbound.headers["x-org-token"]
        if (user) GG_USER_TOKEN.set(user as never)
        if (org)  GG_ORG_TOKEN.set(org as never)
    }
}
