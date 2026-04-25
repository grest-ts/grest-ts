import {GGContextKey} from "@grest-ts/context"
import type {GGHttpRequest} from "@grest-ts/http"
import type {GGWebSocketHandshakeContext, GGWebSocketMiddleware} from "@grest-ts/websocket"
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

    updateRequest(req: GGHttpRequest): void {
        const token = GG_INTERNAL_TOKEN.get()
        if (token) {
            req.headers = req.headers ?? {}
            req.headers["x-internal-token"] = token
        }
    }

    parseRequest(req: GGHttpRequest): void {
        const header = req.headers?.["x-internal-token"]
        if (header && typeof header === "string") {
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
 *   Browser  ──updateHandshake──>  reads GG_USER_TOKEN/GG_ORG_TOKEN from the
 *                                  ambient browser context, writes tokens
 *                                  into the handshake header map.
 *   Server   ──parseHandshake──>   reads the tokens back into GG_USER_TOKEN /
 *                                  GG_ORG_TOKEN on the WS connection context.
 *
 * Pure transport — no decryption, no validation. socket-server attaches a
 * separate validation middleware that reads the context tokens, decrypts
 * them via TokenService, and sets the higher-level payload keys.
 */
export class SocketAuthHeaderMiddleware implements GGWebSocketMiddleware {

    updateHandshake(ctx: GGWebSocketHandshakeContext): void {
        const user = GG_USER_TOKEN.get()
        const org = GG_ORG_TOKEN.get()
        if (user) ctx.headers["x-user-token"] = user
        if (org)  ctx.headers["x-org-token"]  = org
    }

    parseHandshake(ctx: GGWebSocketHandshakeContext): void {
        const user = ctx.headers["x-user-token"]
        const org = ctx.headers["x-org-token"]
        if (user) GG_USER_TOKEN.set(user as never)
        if (org)  GG_ORG_TOKEN.set(org as never)
    }
}
