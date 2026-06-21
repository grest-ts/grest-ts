import type {GGTransportMiddleware} from "@grest-ts/context";
import type {GGPermission, GGValidator} from "@grest-ts/schema";

export interface GGRawWebSocketSchemaConfig<TQuery> {
    name: string;
    path: string;
    middlewares: readonly GGTransportMiddleware[];
    queryValidator?: GGValidator<TQuery>;
    connectPermission?: GGPermission;
    /**
     * Passthrough mode — auth runs against the HTTP upgrade request, no in-band handshake,
     * no HANDSHAKE_OK. For foreign clients that can't speak the grest-ts handshake (noVNC,
     * a proxied editor webview). `.bytes()` produces the in-band variant (`false`).
     */
    passthrough: boolean;
    /** Subprotocols to echo back (passthrough only); first client-requested match wins. */
    protocols?: readonly string[];
}

/**
 * Raw WebSocket API schema — a byte-stream socket.
 *
 * Carries the same connection-level concerns as a typed schema (path, auth wires, query
 * validation, connect permission) but no message contract: once the connection is
 * authenticated, the application owns the wire as an opaque byte stream. Built only via the
 * `webSocketSchema(name).…bytes()` / `.passthrough()` terminals — never constructed directly.
 * `startServer`/`createClient` are attached by the server and client extension modules.
 */
export class GGRawWebSocketSchema<TQuery = undefined> {
    public readonly name: string;
    public readonly path: string;
    public readonly middlewares: readonly GGTransportMiddleware[];
    public readonly queryValidator?: GGValidator<TQuery>;
    public readonly connectPermission?: GGPermission;
    public readonly passthrough: boolean;
    public readonly protocols?: readonly string[];
    public readonly raw = true as const;

    constructor(config: GGRawWebSocketSchemaConfig<TQuery>) {
        this.name = config.name;
        this.path = config.path;
        this.middlewares = Object.freeze([...config.middlewares]);
        this.queryValidator = config.queryValidator;
        this.connectPermission = config.connectPermission;
        this.passthrough = config.passthrough;
        this.protocols = config.protocols ? Object.freeze([...config.protocols]) : undefined;
    }
}
