import type {GGSchemaDescription} from "@grest-ts/schema";

// Structural, not GGSchema<T>: GGSchema is invariant in T, so a typed field would reject branded header schemas.
export interface GGHeaderSchema {
    toSchemaDescription(): GGSchemaDescription;
}

/**
 * Inbound credentials a server reads. Headers are flattened to a single value by the
 * runtime, so middleware never deals with `string[]`.
 */
export interface GGInbound {
    headers: Record<string, string | undefined>;
    /**
     * The raw `Cookie` request header — every cookie packed into one string
     * (`a=1; b=2`), exactly as the client sends it (RFC 6265 allows only one Cookie
     * header). A binding splits out its own named cookie. For WebSocket this is filled
     * only from the real HTTP upgrade request, never from the spoofable in-band message.
     */
    cookie?: string;
    query: Record<string, string | undefined>;
}

/** Outbound credentials a client writes — request headers (HTTP) or handshake headers (WS). */
export interface GGOutbound {
    headers: Record<string, string>;
}

/** Response headers a server writes. `string[]` carries multiple set-cookie lines. */
export interface GGResponse {
    headers: Record<string, string | string[]>;
}

/**
 * One middleware for both HTTP and WebSocket. The runtime calls the relevant subset of
 * hooks per side and transport: a client runs `update`; a server runs `parse → process →
 * respond`. A middleware implements only the hooks it needs and never knows its transport.
 */
export interface GGTransportMiddleware {

    /** Inbound headers this middleware reads/writes — CORS Allow-Headers + OpenAPI/AsyncAPI docs. */
    readonly headers?: Record<string, GGHeaderSchema>;
    /** Response headers this middleware sets — CORS Expose-Headers + OpenAPI response-header docs. */
    readonly responseHeaders?: Record<string, GGHeaderSchema>;
    /** Cookies this middleware reads — emitted as `in: cookie` OpenAPI params. */
    readonly cookieParams?: Record<string, GGHeaderSchema>;

    /** Client: write outbound credentials. */
    update?(outbound: GGOutbound): void;

    /** Server: read inbound credentials into context. */
    parse?(inbound: GGInbound): void;

    /** Server: async validation after all parsing is done. Throwing rejects the request/connection. */
    process?(): Promise<void>;

    /**
     * Server: drop any ephemeral inbound value after process() and before the handler runs.
     * A smart wire clears its raw credential here so handlers read undefined, never the token.
     */
    clear?(): void;

    /** Server: write response headers (set-cookie etc.). */
    respond?(response: GGResponse): void;
}
