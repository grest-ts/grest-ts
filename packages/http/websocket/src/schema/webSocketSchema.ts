import {GGWebSocketSchema, GGWebSocketContractRuntime} from "./GGWebSocketSchema";
import {GGRawWebSocketSchema} from "./GGRawWebSocketSchema";
import type {GGTransportMiddleware} from "@grest-ts/context";
import {GGContractClass, GGContractClient, GGContractImplementation, GGContractMethod, GGPermission, GGValidator} from "@grest-ts/schema";

/**
 * Bidirectional websocket contract methods.
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

/** A typed websocket contract — a name and its message maps. */
export interface GGSocketContract<TDef extends GGSocketContractMethods = GGSocketContractMethods> {
    name: string
    methods: TDef
}

/**
 * A byte-stream websocket contract — opaque bytes, no message maps. `customClient` selects
 * the foreign-client mode (the client is not grest-ts: auth runs at the HTTP upgrade, no
 * in-band handshake, no grest-ts client). Default (`false`) is a grest-ts-both-ends byte
 * stream with first-message handshake auth and a grest-ts `createClient`.
 */
export interface GGRawSocketContract {
    name: string
    raw: true
    customClient: boolean
    protocols?: readonly string[]
}

/**
 * The byte-stream descriptor passed to `defineSocketContract`. `customClient: true` means the
 * client is foreign (noVNC, an editor webview, a proxied app) — `protocols` (subprotocol echo)
 * applies only then.
 */
export type GGRawSocketContractDef =
    | {raw: true; customClient?: false}
    | {raw: true; customClient: true; protocols?: readonly string[]}

/**
 * Define a websocket contract — the named entity bound by `webSocketSchema(contract)`,
 * mirroring `new GGContractClass(...)` + `httpSchema(contract)` on the HTTP side.
 *
 * - Typed socket: pass the `{clientToServer, serverToClient}` message maps.
 * - Byte stream (grest-ts client): pass `{raw: true}`.
 * - Byte stream with a custom (foreign) client: pass `{raw: true, customClient: true, protocols?}`.
 *
 * @example
 * const Chat = defineSocketContract("Chat", {clientToServer: {...}, serverToClient: {...}})
 * const Pty = defineSocketContract("Pty", {raw: true})
 * const Desktop = defineSocketContract("Desktop", {raw: true, customClient: true, protocols: ["binary"]})
 */
export function defineSocketContract<TDef extends GGSocketContractMethods>(name: string, methods: TDef): GGSocketContract<TDef>
export function defineSocketContract(name: string, def: GGRawSocketContractDef): GGRawSocketContract
export function defineSocketContract(
    name: string,
    def: GGSocketContractMethods | GGRawSocketContractDef
): GGSocketContract | GGRawSocketContract {
    if ("raw" in def) {
        return {
            name,
            raw: true,
            customClient: def.customClient === true,
            protocols: "protocols" in def ? def.protocols : undefined,
        }
    }
    return {name, methods: def}
}

/**
 * Bind a websocket contract to a transport (path, auth wires, query, connect permission).
 * Typed and raw contracts share the same builder chain; `.done()` finalizes the matching
 * schema (typed → `GGWebSocketSchema`, raw → `GGRawWebSocketSchema`).
 *
 * @example
 * export const ChatApi = webSocketSchema(Chat).path("ws/chat").use(AUTH).done()
 * export const Pty = webSocketSchema(PtyContract).path("ws/pty").use(SESSION).queryOnConnect(IsQ).done()
 */
export function webSocketSchema<TDef extends GGSocketContractMethods>(
    contract: GGSocketContract<TDef>
): GGWebSocketSchemaBuilder<
    GGContractClient<TDef["clientToServer"]>,
    GGContractClient<TDef["serverToClient"]>,
    undefined,
    undefined,
    GGContractImplementation<TDef["clientToServer"]>,
    GGContractImplementation<TDef["serverToClient"]>
>
export function webSocketSchema(contract: GGRawSocketContract): GGRawWebSocketSchemaBuilder
export function webSocketSchema(
    contract: GGSocketContract | GGRawSocketContract
): GGWebSocketSchemaBuilder<any, any, any, any, any, any> | GGRawWebSocketSchemaBuilder {
    if ("raw" in contract) {
        return new GGRawWebSocketSchemaBuilder(contract)
    }
    return new GGWebSocketSchemaBuilder(contract)
}

class GGWebSocketSchemaBuilder<
    TClientToServer,
    TServerToClient,
    TContext = undefined,
    TQuery = undefined,
    TClientToServerImpl = TClientToServer,
    TServerToClientImpl = TServerToClient
> {
    private readonly _contract: GGSocketContract
    private _path: string = ""
    private readonly _middlewares: GGTransportMiddleware[] = []
    private _queryValidator?: GGValidator<any>
    private _connectPermission?: GGPermission

    constructor(contract: GGSocketContract) {
        this._contract = contract
    }

    path(path: string): this {
        this._path = path
        return this
    }

    use<M extends GGTransportMiddleware>(middleware: M): GGWebSocketSchemaBuilder<TClientToServer, TServerToClient, TContext | M, TQuery, TClientToServerImpl, TServerToClientImpl> {
        this._middlewares.push(middleware)
        return this as any
    }

    /**
     * Declare the query-parameter shape and validator for connections.
     * The validator runs on the server (connections with invalid query are rejected
     * before handshake) and on the client (invalid query throws before connecting).
     */
    queryOnConnect<TNewQuery>(validator: GGValidator<TNewQuery>): GGWebSocketSchemaBuilder<TClientToServer, TServerToClient, TContext, TNewQuery, TClientToServerImpl, TServerToClientImpl> {
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

    done(): GGWebSocketSchema<TClientToServer, TServerToClient, TContext, TQuery, TClientToServerImpl, TServerToClientImpl> {
        assertValidSocketPath(this._path, this._contract.name);
        const contract = this._contract;
        const contractFactory = (): GGWebSocketContractRuntime => {
            const methods = contract.methods;
            const name = contract.name;
            return {
                apiName: name,
                clientToServer: new GGContractClass(name + ".clientToServer", methods.clientToServer),
                serverToClient: new GGContractClass(name + ".serverToClient", methods.serverToClient)
            };
        };

        return new GGWebSocketSchema<TClientToServer, TServerToClient, TContext, TQuery, TClientToServerImpl, TServerToClientImpl>(
            contract.name,
            this._path,
            contractFactory,
            this._middlewares,
            this._queryValidator,
            this._connectPermission
        )
    }
}

class GGRawWebSocketSchemaBuilder<TQuery = undefined> {
    private readonly _contract: GGRawSocketContract
    private _path: string = ""
    private readonly _middlewares: GGTransportMiddleware[] = []
    private _queryValidator?: GGValidator<any>
    private _connectPermission?: GGPermission

    constructor(contract: GGRawSocketContract) {
        this._contract = contract
    }

    path(path: string): this {
        this._path = path
        return this
    }

    use<M extends GGTransportMiddleware>(middleware: M): this {
        this._middlewares.push(middleware)
        return this
    }

    queryOnConnect<TNewQuery>(validator: GGValidator<TNewQuery>): GGRawWebSocketSchemaBuilder<TNewQuery> {
        this._queryValidator = validator
        return this as any
    }

    connectPermission(permission: GGPermission): this {
        this._connectPermission = permission
        return this
    }

    done(): GGRawWebSocketSchema<TQuery> {
        assertValidSocketPath(this._path, this._contract.name, this._contract.customClient)
        // A custom client is foreign and never sends the in-band handshake, so a wire that
        // delivers its credential there (an update() writer, e.g. GGHeader) could never arrive —
        // the socket would open unauthenticated while looking gated. Reject at build time; only
        // upgrade-readable credentials (cookie, ?query=) are legal with a custom client.
        if (this._contract.customClient && this._middlewares.some(m => typeof m.update === "function")) {
            throw new Error(
                `webSocketSchema "${this._contract.name}": a customClient byte socket cannot use a credential ` +
                `delivered via the grest-ts handshake (a wire with update(), e.g. GGHeader). A custom client is ` +
                `foreign and never sends the in-band handshake, so this credential could never arrive and the ` +
                `socket would open unauthenticated. Authenticate via a cookie or "?query=" credential instead.`
            )
        }
        return new GGRawWebSocketSchema<TQuery>({
            name: this._contract.name,
            path: this._path,
            middlewares: this._middlewares,
            queryValidator: this._queryValidator,
            connectPermission: this._connectPermission,
            customClient: this._contract.customClient,
            protocols: this._contract.protocols,
        })
    }
}

/**
 * The base of a socket path: a `"/base/*"` wildcard prefix maps to `"/base"`, an exact path is
 * itself. The single source of truth for stripping the wildcard suffix — used by path validation
 * and by the discovery registration (which routes by `startsWith(base)`).
 */
export function wildcardPathBase(path: string): string {
    return path.endsWith("/*") ? path.slice(0, -2) : path
}

/**
 * A WS path is matched against the upgrade request's pathname (after a leading slash is ensured),
 * so a path that is empty or carries whitespace / a query / a fragment can never match a real
 * connection — the schema would silently accept zero clients. Reject it at build time.
 *
 * A trailing `/*` makes the path a prefix (matches `/base` and anything under `/base/`), allowed
 * only when `allowPrefix` is set — i.e. on a customClient contract, where a foreign client opens
 * dynamic subpaths. A `*` anywhere else is rejected.
 */
export function assertValidSocketPath(path: string, apiName: string, allowPrefix = false): void {
    const isPrefix = path.endsWith("/*")
    const core = wildcardPathBase(path)
    if (core === "" || /\s/.test(core) || core.includes("?") || core.includes("#") || core.includes("*")) {
        throw new Error(
            `webSocketSchema "${apiName}": invalid path ${JSON.stringify(path)} — a WebSocket path must be ` +
            `non-empty and contain no whitespace, "?" or "#" (it is matched against the upgrade request pathname). ` +
            `A wildcard is only allowed as a trailing "/*".`
        )
    }
    if (isPrefix && !allowPrefix) {
        throw new Error(
            `webSocketSchema "${apiName}": a wildcard prefix path (${JSON.stringify(path)}) is only valid for a ` +
            `customClient contract — a foreign client opens dynamic subpaths, while a typed or grest-ts byte ` +
            `socket connects at one exact path (its createClient builds that exact URL).`
        )
    }
}
