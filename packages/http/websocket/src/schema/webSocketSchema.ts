import {GGWebSocketSchema, GGWebSocketContractRuntime} from "./GGWebSocketSchema";
import {GGRawWebSocketSchema} from "./GGRawWebSocketSchema";
import type {GGTransportMiddleware} from "@grest-ts/context";
import {GGContractClass, GGContractClient, GGContractImplementation, GGContractMethod, GGPermission, GGValidator} from "@grest-ts/schema";

/**
 * Bidirectional websocket message maps, passed to `.messages({...})`.
 *
 * Both directions use GGContractMethod (which requires `permission`), but only
 * the `clientToServer` permission is enforced by the gate — server-pushed
 * messages have no caller identity to check against. By convention, set
 * `serverToClient` methods to `permission: GG_NO_PERMISSIONS`.
 */
export interface GGSocketContractMethods {
    clientToServer: Record<string, GGContractMethod>
    serverToClient: Record<string, GGContractMethod>
}

/**
 * Create a WebSocket schema builder. The builder owns the connection-level config
 * (`path` / `use` / `queryOnConnect` / `connectPermission`); a terminal picks the
 * payload + mode and finalizes the schema:
 *
 * - `.messages({clientToServer, serverToClient})` — typed contract, both ends grest-ts.
 * - `.bytes()` — opaque byte stream, both ends grest-ts (in-band handshake auth).
 * - `.passthrough({protocols})` — opaque byte stream, foreign client (upgrade auth only).
 *
 * @example
 * export const Chat = webSocketSchema("Chat")
 *     .path("/ws/chat").use(AUTH)
 *     .messages({
 *         clientToServer: {sendMessage: {input: IsMessage, errors: [SERVER_ERROR], permission: P}},
 *         serverToClient: {onMessage: {input: IsMessage, permission: GG_NO_PERMISSIONS}},
 *     })
 *
 * export const Terminal = webSocketSchema("Terminal")
 *     .path("/ws/terminal").use(GG_RELAY_TOKEN).queryOnConnect(IsTokenQ)
 *     .bytes()
 *
 * export const Desktop = webSocketSchema("Desktop")
 *     .path("/ws/desktop").use(DESKTOP_TOKEN_QUERY)
 *     .passthrough({protocols: ["binary"]})
 */
export function webSocketSchema(name: string): GGWebSocketSchemaBuilder {
    return new GGWebSocketSchemaBuilder(name)
}

class GGWebSocketSchemaBuilder<TContext = undefined, TQuery = undefined> {
    private readonly _name: string
    private _path: string = ""
    private readonly _middlewares: GGTransportMiddleware[] = []
    private _queryValidator?: GGValidator<any>
    private _connectPermission?: GGPermission

    constructor(name: string) {
        this._name = name
    }

    path(path: string): this {
        this._path = path
        return this
    }

    use<M extends GGTransportMiddleware>(middleware: M): GGWebSocketSchemaBuilder<TContext | M, TQuery> {
        this._middlewares.push(middleware)
        return this as any
    }

    /**
     * Declare the query-parameter shape and validator for connections.
     * The validator runs on the server (connections with invalid query are rejected
     * before handshake) and on the client (invalid query throws before connecting).
     */
    queryOnConnect<TNewQuery>(validator: GGValidator<TNewQuery>): GGWebSocketSchemaBuilder<TContext, TNewQuery> {
        this._queryValidator = validator
        return this as any
    }

    /**
     * Require a connection-level permission. The scope resolver runs once at
     * handshake and the result is checked against this permission BEFORE the
     * socket opens. Use this for "feature-specific" sockets where lacking
     * permission means there's no point opening the connection. Per-message
     * gates on individual clientToServer methods still apply.
     *
     * Omit this builder call for general multiplex sockets — authenticated
     * users can connect, and each message is gated by its own permission.
     */
    connectPermission(permission: GGPermission): this {
        this._connectPermission = permission
        return this
    }

    /** Typed-contract terminal — both ends speak grest-ts; first-message auth, reconnect/liveness. */
    messages<TDef extends GGSocketContractMethods>(methods: TDef): GGWebSocketSchema<
        GGContractClient<TDef["clientToServer"]>,
        GGContractClient<TDef["serverToClient"]>,
        TContext,
        TQuery,
        GGContractImplementation<TDef["clientToServer"]>,
        GGContractImplementation<TDef["serverToClient"]>
    > {
        assertValidSocketPath(this._path, this._name)
        const name = this._name
        const contractFactory = (): GGWebSocketContractRuntime => ({
            apiName: name,
            clientToServer: new GGContractClass(name + ".clientToServer", methods.clientToServer),
            serverToClient: new GGContractClass(name + ".serverToClient", methods.serverToClient),
        })

        return new GGWebSocketSchema(
            name,
            this._path,
            contractFactory,
            this._middlewares,
            this._queryValidator,
            this._connectPermission
        )
    }

    /** Byte-stream terminal — both ends speak grest-ts; in-band handshake auth, reconnect/liveness. */
    bytes(): GGRawWebSocketSchema<TQuery> {
        assertValidSocketPath(this._path, this._name)
        return new GGRawWebSocketSchema<TQuery>({
            name: this._name,
            path: this._path,
            middlewares: this._middlewares,
            queryValidator: this._queryValidator,
            connectPermission: this._connectPermission,
            passthrough: false,
        })
    }

    /**
     * Passthrough terminal — a foreign client (noVNC, an editor webview) that can't speak the
     * grest-ts handshake. Auth runs against the HTTP upgrade request (cookie / `?query=`); no
     * in-band message, no HANDSHAKE_OK, no grest-ts client.
     *
     * A foreign client never sends the handshake, so any `.use()`'d wire that delivers its
     * credential in-band (an `update()` writer, e.g. GGHeader) could never arrive — the socket
     * would open unauthenticated while looking gated. Reject that combination here at build time.
     */
    passthrough(options: {protocols?: readonly string[]} = {}): GGRawWebSocketSchema<TQuery> {
        assertValidSocketPath(this._path, this._name)
        if (this._middlewares.some(m => typeof m.update === "function")) {
            throw new Error(
                `webSocketSchema "${this._name}": .passthrough() cannot use a credential delivered via the ` +
                `grest-ts handshake (a wire with update(), e.g. GGHeader). A passthrough client is foreign and ` +
                `never sends the in-band handshake, so this credential could never arrive and the socket would ` +
                `open unauthenticated. Authenticate via a cookie or "?query=" credential instead.`
            )
        }
        return new GGRawWebSocketSchema<TQuery>({
            name: this._name,
            path: this._path,
            middlewares: this._middlewares,
            queryValidator: this._queryValidator,
            connectPermission: this._connectPermission,
            passthrough: true,
            protocols: options.protocols,
        })
    }
}

/**
 * A WS path is matched verbatim against the upgrade request's pathname (after a leading slash is
 * ensured), so a path that is empty or carries whitespace / a query / a fragment can never match a
 * real connection — the schema would silently accept zero clients. Reject it at build time.
 */
export function assertValidSocketPath(path: string, apiName: string): void {
    if (path === "" || /\s/.test(path) || path.includes("?") || path.includes("#")) {
        throw new Error(
            `webSocketSchema "${apiName}": invalid path ${JSON.stringify(path)} — a WebSocket path must be ` +
            `non-empty and contain no whitespace, "?" or "#" (it is matched against the upgrade request pathname).`
        )
    }
}
