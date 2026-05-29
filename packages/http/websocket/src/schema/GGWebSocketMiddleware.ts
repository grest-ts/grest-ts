import type {GGSchema} from "@grest-ts/schema";

/**
 * WebSocket-specific middleware interface.
 * Independent from @grest-ts/http - WebSocket has its own middleware system.
 */

/**
 * Context available during WebSocket handshake.
 */
export interface GGWebSocketHandshakeContext {
    /**
     * Headers from the in-band handshake message (client-sent or server-received).
     * This is the client-JS-authored bag — the transport for things like a bearer
     * token, since a browser cannot set request headers on a WebSocket.
     */
    headers: Record<string, string>;
    /**
     * Server-only: the real HTTP upgrade request headers (lowercased). Carries
     * browser-set headers the in-band `headers` map cannot — notably `cookie`
     * (a browser auto-attaches it to the upgrade GET; JS cannot read an httpOnly
     * one to put it in-band). Empty/undefined client-side. The in-band message can
     * never populate this, so it cannot spoof a browser cookie.
     */
    upgradeHeaders?: Record<string, string>;
    /**
     * Query parameters from the WebSocket URL.
     */
    queryArgs: Record<string, string>;
}

/**
 * WebSocket middleware interface for both client and server.
 * Unlike HTTP middleware, WebSocket middleware works with handshake data.
 */
export interface GGWebSocketMiddleware {
    /**
     * Handshake headers this middleware reads or writes, mapped to their value schemas.
     * Keys are header names; values describe the header value format for docs and OpenAPI/AsyncAPI.
     * Use {} if the middleware touches no custom handshake headers.
     *
     * @example
     * headers: {
     *   "authorization": IsBearerToken.docs({description: "JWT access token"})
     * }
     */
    readonly headers?: Record<string, GGSchema<string | undefined>>;

    /**
     * Client-side: Add headers to the handshake message before sending.
     * Called by GGSocketPool when establishing a connection.
     */
    updateHandshake?(context: GGWebSocketHandshakeContext): void;

    /**
     * Server-side: Parse headers from the received handshake message.
     * Called by GGSocketServer when receiving a connection.
     */
    parseHandshake?(context: GGWebSocketHandshakeContext): void;

    /**
     * Server-side: Async processing after parseHandshake.
     * Can be used for authentication, authorization, etc.
     * Throwing an error will reject the connection.
     */
    process?(): Promise<void>;
}
