/**
 * Server extension for WebSocketSchema - adds startServer and register methods
 * This file should only be imported in server (Node.js) context
 */

import type {GGSocket} from "../socket/GGSocket"
import {GGWebSocketSchema} from "../schema/GGWebSocketSchema";
import {type GGTransportMiddleware} from "@grest-ts/context";
import {GGSocketServer} from "./GGSocketServer";
import {GGLocator} from "@grest-ts/locator";
import {WebSocketIncoming, WebSocketOutgoing} from "../socket/WebSocketTypes";
import {GG_HTTP_SERVER, GGHttpServer} from "@grest-ts/http";
import {GGHttpPermissionsChecker} from "@grest-ts/http";
import {GGPromise} from "@grest-ts/schema";

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
    const permissionsChecker = new GGHttpPermissionsChecker(this.middlewares);
    const middlewares: GGTransportMiddleware[] = [...this.middlewares, ...(config?.middlewares ?? [])]
    // Gate the handshake: resolve scopes and assert connectPermission here so a failed
    // permission (or a throwing resolver) rejects the handshake. onConnection runs after
    // HANDSHAKE_OK, so a check there can't reject — it only re-snapshots scopes per-message.
    middlewares.push({
        async process() {
            await permissionsChecker.assert(schemaName, "", connectPermission)
        },
    })

    // @TODO We might want some lookup here based on path/middlewares etc. If I use same socket for multiple paths, we need to reuse also same GGSocketServer.
    const socketServer = new GGSocketServer(http, {
        apiName: schemaName,
        path: normalizedPath,
        middlewares,
        queryValidator: this.queryValidator,
    });

    socketServer.onConnection(async (socket: GGSocket, queryArgs: any): Promise<void> => {
        const clientToServerContract = contract.clientToServer
        const serverToClientContract = contract.serverToClient
        const scopesOnConnection = await permissionsChecker.assert(schemaName, "", connectPermission)
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
                    socket.registerHandler({
                        path: `${schemaName}.${methodName}`,
                        handler: (data: any) => {
                            try {
                                permissionsChecker.assertScopes(schemaName, methodName, scopesOnConnection, required)
                            } catch (error) {
                                return new GGPromise(Promise.resolve(error))
                            }
                            return inner(data)
                        }
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

