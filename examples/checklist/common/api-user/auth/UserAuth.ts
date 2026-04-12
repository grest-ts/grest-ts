import type http from "http";
import {GGHttpRequest} from "@grest-ts/http"
import {GGWebSocketHandshakeContext} from "@grest-ts/websocket"
import {GGSchema, IsBearerToken, NOT_AUTHORIZED} from "@grest-ts/schema";
import {GGContextKey} from "@grest-ts/context";

export const IsUserAuthToken = IsString.brand("UserAuthToken");
export type tUserAuthToken = typeof IsUserAuthToken.infer

export const IsUserId = IsString.brand("UserId");
export type tUserId = typeof IsUserId.infer

export const IsUser = IsObject({
    id: IsUserId,
    username: IsString,
    email: IsString
})
export type User = typeof IsUser.infer

/**
 * User authentication middleware that works with both HTTP and WebSocket.
 * Implements both GGHttpTransportMiddleware and GGWebSocketMiddleware interfaces.
 */
export class UserAuth extends GGContextKey<tUserAuthToken> {

    readonly headers: Record<string, GGSchema<string | undefined>> = {
        "authorization": IsBearerToken.docs({
            description: "JWT bearer token for user authentication",
            example: "Bearer eyJhbGciOiJIUzI1NiJ9..."
        })
    };
    readonly responseHeaders: Record<string, GGSchema<string | undefined>> = {};

    // =========================================================================
    // HTTP Middleware Interface (GGHttpTransportMiddleware)
    // =========================================================================

    updateRequest(req: GGHttpRequest): void {
        const user = GG_USER_AUTH_TOKEN.get();
        if (user) {
            req.headers["authorization"] = `Bearer ${user}`;
        }
    }

    parseRequest(req: http.IncomingMessage): void {
        this.parseAuthHeader(req.headers as Record<string, string>);
    }

    // =========================================================================
    // WebSocket Middleware Interface (GGWebSocketMiddleware)
    // =========================================================================

    updateHandshake(context: GGWebSocketHandshakeContext): void {
        const user = GG_USER_AUTH_TOKEN.get();
        if (user) {
            context.headers["authorization"] = `Bearer ${user}`;
        }
    }

    parseHandshake(context: GGWebSocketHandshakeContext): void {
        this.parseAuthHeader(context.headers);
    }

    // =========================================================================
    // Shared Implementation
    // =========================================================================

    private parseAuthHeader(headers: Record<string, string>): void {
        const authHeader = headers['authorization'];
        if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
            throw new NOT_AUTHORIZED({displayMessage: "Invalid authorization header!"});
        }
        GG_USER_AUTH_TOKEN.set(authHeader.substring(7) as tUserAuthToken);
    }

}

export const GG_USER_AUTH_TOKEN = new UserAuth('user', IsUserAuthToken);
