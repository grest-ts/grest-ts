/**
 * Server extension for WebSocketSchema - adds startServer and register methods
 * This file should only be imported in server (Node.js) context
 */

import type {GGSocket} from "../socket/GGSocket"
import {GGWebSocketSchema} from "../schema/GGWebSocketSchema";
import {GGContextKey, type GGTransportMiddleware} from "@grest-ts/context";
import {GGSocketServer} from "./GGSocketServer";
import {GGLocator} from "@grest-ts/locator";
import {WebSocketIncoming, WebSocketOutgoing} from "../socket/WebSocketTypes";
import {describePermission, FORBIDDEN, GG_NO_PERMISSIONS, GGPromise, IsAny, satisfies} from "@grest-ts/schema";
import {GG_HTTP_SERVER, GGHttpServer, GGWireContextKey} from "@grest-ts/http";

const HANDSHAKE_SCOPES = new GGContextKey<ReadonlySet<string>>("ws:handshake-scopes", IsAny as any);

export interface WebSocketSchemaConfig {
    /**
     * The HTTP server adapter to attach the WebSocket server to.
     * If not provided, will look up from locator.
     */
    http?: GGHttpServer;
    /**
     * Additional middlewares to apply to all connections.
     */
    middlewares?: GGTransportMiddleware[];
}

declare module "../schema/GGWebSocketSchema" {
    interface GGWebSocketSchema<TClientToServer, TServerToClient, TContext = {}, TQuery = undefined, TClientToServerImpl = TClientToServer, TServerToClientImpl = TServerToClient> {
        /**
         * Start the WebSocket server for this API.
         * The onConnection handler receives validated query parameters as its 3rd argument
         * (only populated when the schema declares `queryOnConnect(validator)`).
         */
        startServer(
            onConnection: (incoming: WebSocketIncoming<TClientToServerImpl>, outgoing: WebSocketOutgoing<TServerToClient>, query: TQuery) => void,
            config: WebSocketSchemaConfig
        ): GGSocketServer<TContext, TQuery>

        /**
         * Register this WebSocket API with the default HTTP server.
         * Uses GGHttpServerAdapter from locator if not explicitly provided.
         */
        register(
            onConnection: (incoming: WebSocketIncoming<TClientToServerImpl>, outgoing: WebSocketOutgoing<TServerToClient>, query: TQuery) => void,
            config?: WebSocketSchemaConfig
        ): void
    }
}

GGWebSocketSchema.prototype.startServer = function (
    this: GGWebSocketSchema<any, any, any, any, any, any>,
    onConnection: any,
    config: WebSocketSchemaConfig
): GGSocketServer<any, any> {
    const contract = this.contract
    if (!contract) {
        throw new Error(`WebSocketSchema "${this.name}" has no contract.`)
    }

    const normalizedPath = this.path.startsWith('/') ? this.path : '/' + this.path
    const schemaName = this.name
    const http = config.http ?? GGLocator.getScope().get(GG_HTTP_SERVER);
    http._registerWebSocketSchema(this as any);

    const connectPermission = this.connectPermission

    // Smart wires on the schema ARE the scope resolver — same model as HTTP. Each wire's
    // process() (run at handshake) mints its durable principal; permissions() yields the
    // caller's grants.
    const wires = this.middlewares.filter((mw): mw is GGWireContextKey => mw instanceof GGWireContextKey)

    // Permission gate as a handshake middleware: runs after user middlewares
    // (so identity is already in context), resolves scopes, caches them on
    // HANDSHAKE_SCOPES for onConnection, and rejects the handshake with a typed
    // FORBIDDEN if the connectPermission doesn't hold. The throw is caught by
    // handleHandshake and surfaced to the client as a HANDSHAKE_ERR — not a
    // silent disconnect.
    const middlewares: GGTransportMiddleware[] = [...this.middlewares, ...(config?.middlewares ?? [])]
    middlewares.push({
        async process() {
            const scopes = new Set<string>()
            for (let i = 0; i < wires.length; i++) {
                const permissions = await wires[i].permissions()
                for (let p = 0; p < permissions.length; p++) {
                    scopes.add(permissions[p])
                }
            }
            HANDSHAKE_SCOPES.set(scopes)
            if (connectPermission !== undefined && connectPermission !== GG_NO_PERMISSIONS && !satisfies(connectPermission, scopes)) {
                throw new FORBIDDEN({
                    debugMessage: `${schemaName} connection requires ${describePermission(connectPermission)} — caller scopes did not satisfy`,
                })
            }
        },
    })

    // @TODO We might want some lookup here based on path/middlewares etc. If I use same socket for multiple paths, we need to reuse also same GGSocketServer.
    const socketServer = new GGSocketServer(http, {
        apiName: schemaName,
        path: normalizedPath,
        middlewares,
        queryValidator: this.queryValidator,
    });

    socketServer.onConnection((socket: GGSocket, queryArgs: any) => {
        const clientToServerContract = contract.clientToServer
        const serverToClientContract = contract.serverToClient

        // Handshake middleware (above) resolved scopes and cached them on
        // HANDSHAKE_SCOPES for the lifetime of this connection. Capture them into a
        // closure so per-message handlers gate without re-resolving — a 10-year-old
        // socket keeps the scopes it was issued at handshake, never re-fetched.
        const cachedScopes: ReadonlySet<string> = HANDSHAKE_SCOPES.get()

        const incoming: any = {
            on(handlers: any) {
                const impl: Record<string, any> = {};
                for (const methodName of Object.keys(clientToServerContract.methods)) {
                    const methodDef = clientToServerContract.methods[methodName] as any;
                    const params = methodDef.params;
                    impl[methodName] = (data: any) => {
                        // If method has params info, unpack data object to positional args
                        if (params && params.length > 0 && data && typeof data === 'object') {
                            const args = params.map((p: any) => data[p.name]);
                            return handlers[methodName](...args);
                        }
                        // Single or no parameter - pass directly
                        return handlers[methodName](data);
                    };
                }

                const incomingInstance = clientToServerContract.implement(impl, {skipLocatorRegistration: true});

                for (const methodName of Object.keys(clientToServerContract.methods)) {
                    const methodDef = clientToServerContract.methods[methodName] as any
                    const required = methodDef.permission
                    const inner = (incomingInstance as any)[methodName]
                    const requiresGate = required !== undefined && required !== GG_NO_PERMISSIONS
                    const wrapped = !requiresGate
                        ? inner
                        : (data: any) => {
                            if (!satisfies(required, cachedScopes)) {
                                return new GGPromise(Promise.resolve(new FORBIDDEN({
                                    debugMessage: `${schemaName}.${methodName} requires ${describePermission(required)} — caller scopes did not satisfy`
                                })))
                            }
                            return inner(data)
                        }
                    socket.registerHandler({
                        path: `${schemaName}.${methodName}`,
                        handler: wrapped
                    });
                }
            }
        }

        const impl: Record<string, any> = {};
        for (const methodName of Object.keys(serverToClientContract.methods)) {
            const method = serverToClientContract.methods[methodName];
            const expectsResponse = 'success' in method;
            impl[methodName] = (data: any) => {
                return socket.send(`${schemaName}.${methodName}`, data, expectsResponse);
            };
        }

        const outgoingInstance = serverToClientContract.implement(impl, {skipLocatorRegistration: true});
        (outgoingInstance as any).onClose = (callback: () => void) => {
            socket.onClose(callback)
        }
        onConnection(incoming, outgoingInstance, queryArgs)
    });

    return socketServer;
}

GGWebSocketSchema.prototype.register = function (
    this: GGWebSocketSchema<any, any, any, any, any, any>,
    onConnection: any,
    config?: WebSocketSchemaConfig
): void {
    let httpServer = config?.http;
    if (!httpServer) {
        httpServer = GGLocator.getScope().get(GG_HTTP_SERVER);
    }
    if (!httpServer) {
        throw new Error(`No HTTP server found. Make sure to register GGHttpServerAdapter in the scope or pass it via config`)
    }

    this.startServer(onConnection, {
        http: httpServer,
        middlewares: config?.middlewares,
    });
}

