import {assertValidSocketPath} from "./webSocketSchema";
import type {GGTransportMiddleware} from "@grest-ts/context";
import type {GGPermission, GGValidator} from "@grest-ts/schema";

export interface RawSocketSchemaOptions<TQuery = undefined> {
    path: string;
    /** Auth + ambient-context middlewares/wires — run over the handshake exactly as on a schema socket. */
    use?: readonly GGTransportMiddleware[];
    /** Query-parameter validator; a connection with invalid query is rejected before the handshake. */
    queryOnConnect?: GGValidator<TQuery>;
    /** Connection-level permission, asserted once at handshake against the wire-resolved scopes. */
    connectPermission?: GGPermission;
}

/**
 * Raw WebSocket API schema — a byte-stream socket.
 *
 * Carries the same connection-level concerns as a `webSocketSchema` (path, auth
 * middlewares/wires, query validation, connect permission) but no message contract:
 * once the handshake authenticates the connection, the application owns the wire as an
 * opaque byte stream. `startServer`/`createRawClient` are attached by the server and
 * client extension modules.
 *
 * There is no fluent builder: a raw schema accumulates no contract/context generics the
 * way `webSocketSchema` does, so an options object says the same thing in less code.
 *
 * @example
 * export const PtyStream = rawSocketSchema("PtyStream", {
 *     path: "ws/pty",
 *     use: [SESSION_WIRE],
 *     queryOnConnect: IsObject({vmId: IsString}),
 *     connectPermission: CanAttachPty,
 * })
 */
export class GGRawWebSocketSchema<TQuery = undefined> {
    public readonly name: string
    public readonly path: string
    public readonly middlewares: readonly GGTransportMiddleware[]
    public readonly queryValidator?: GGValidator<TQuery>
    public readonly connectPermission?: GGPermission
    public readonly raw = true as const

    constructor(name: string, options: RawSocketSchemaOptions<TQuery>) {
        this.name = name
        this.path = options.path
        this.middlewares = Object.freeze([...(options.use ?? [])])
        this.queryValidator = options.queryOnConnect
        this.connectPermission = options.connectPermission
    }
}

export function rawSocketSchema<TQuery = undefined>(
    name: string,
    options: RawSocketSchemaOptions<TQuery>
): GGRawWebSocketSchema<TQuery> {
    assertValidSocketPath(options.path, name)
    return new GGRawWebSocketSchema<TQuery>(name, options)
}
