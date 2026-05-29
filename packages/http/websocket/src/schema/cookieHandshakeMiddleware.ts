import {GGContextKeyForCookie, readCookie} from "@grest-ts/http"
import {GGWebSocketHandshakeContext, GGWebSocketMiddleware} from "./GGWebSocketMiddleware"

/**
 * WebSocket (read-only) half of cookie support. parseHandshake reads the cookie
 * (named by the key) from the REAL upgrade request headers — a browser auto-attaches
 * it to the upgrade GET; the in-band handshake message can't carry an httpOnly cookie
 * and is never consulted here, so it cannot spoof one — and populates the SAME
 * GGContextKeyForCookie that httpSchema(...).useCookie binds. There is no Set-Cookie on
 * a WebSocket, so there is no write/emit path: cookies are minted on HTTP login/refresh
 * and ride the upgrade. Attached via webSocketSchema(...).useCookie(key).
 */
export function createCookieHandshakeMiddleware(key: GGContextKeyForCookie): GGWebSocketMiddleware {
    return {
        headers: {},
        parseHandshake(ctx: GGWebSocketHandshakeContext): void {
            const value = readCookie(ctx.upgradeHeaders?.["cookie"], key.name)
            if (value !== undefined) key.set(value)
        },
    }
}
