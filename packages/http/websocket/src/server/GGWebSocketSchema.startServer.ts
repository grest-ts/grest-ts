/**
 * Server extension for WebSocketSchema - adds startServer and register methods
 * This file should only be imported in server (Node.js) context
 */

import type {GGSocket} from "../socket/GGSocket"
import {GGWebSocketSchema} from "../schema/GGWebSocketSchema";
import {GGWebSocketMiddleware} from "../schema/GGWebSocketMiddleware";
import {GGSocketServer} from "./GGSocketServer";
import {GGLocator} from "@grest-ts/locator";
import {WebSocketIncoming, WebSocketOutgoing} from "../socket/WebSocketTypes";
import {FORBIDDEN, GG_NO_PERMISSIONS, GGPermissionChecker, GGPromise, NOT_AUTHORIZED, satisfies} from "@grest-ts/schema";
import {GG_HTTP_SERVER, GG_PERMISSIONS, GGHttpServer, GGScopeResolver} from "@grest-ts/http";

export interface WebSocketSchemaConfig {
    /**
     * The HTTP server adapter to attach the WebSocket server to.
     * If not provided, will look up from locator.
     */
    http?: GGHttpServer;
    /**
     * Additional middlewares to apply to all connections.
     */
    middlewares?: GGWebSocketMiddleware[];
    /**
     * Optional scope resolver. When set, the gate runs at handshake (to check
     * `.connectPermission(...)` if declared) and on every clientToServer
     * message (to check the contract method's permission). The resolved scope
     * set is cached on the connection — no per-message token re-parsing.
     */
    permissionResolver?: GGScopeResolver;
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

    // Startup permission check (same rule as HTTP): any non-public c2s method
    // requires a wired resolver. serverToClient methods are exempt since the
    // server originates them. .connectPermission on the schema also requires
    // a resolver.
    if (!config.permissionResolver) {
        const c2sMethods = contract.clientToServer.methods
        const offenders: Array<{name: string, permission: any}> = []
        for (const methodName in c2sMethods) {
            const m = c2sMethods[methodName] as any
            if (m.permission !== GG_NO_PERMISSIONS) {
                offenders.push({name: methodName, permission: m.permission})
            }
        }
        const connectGated = this.connectPermission !== undefined && this.connectPermission !== GG_NO_PERMISSIONS
        if (offenders.length > 0 || connectGated) {
            const lines = offenders.map(o => `  ${schemaName}.${o.name}   requires ${describePermission(o.permission)}`).join("\n")
            const connectLine = connectGated ? `  ${schemaName} connectPermission   requires ${describePermission(this.connectPermission)}\n` : ""
            throw new Error(
                `GGWebSocket: cannot register ${schemaName} — these surfaces declare non-public permissions but no scope resolver was registered via config.permissionResolver:\n\n` +
                connectLine + lines +
                `\n\nFix: pass {permissionResolver: yourScopeResolver} when calling ${schemaName}.register(...),\n` +
                `     or set permission: GG_NO_PERMISSIONS on c2s methods that are genuinely public.`
            )
        }
    }

    // @TODO We might want some lookup here based on path/middlewares etc. If I use same socket for multiple paths, we need to reuse also same GGSocketServer.
    const socketServer = new GGSocketServer(http, {
        apiName: schemaName,
        path: normalizedPath,
        middlewares: [...this.middlewares, ...(config?.middlewares ?? [])],
        queryValidator: this.queryValidator,
    });

    const connectPermission = this.connectPermission
    const permissionResolver = config.permissionResolver

    socketServer.onConnection(async (socket: GGSocket, queryArgs: any) => {
        const clientToServerContract = contract.clientToServer
        const serverToClientContract = contract.serverToClient

        // Resolve scopes once at connection start (handshake middlewares already
        // populated context). Result is cached on this closure for every
        // subsequent message on this socket.
        let cachedScopes: ReadonlySet<string> | null = null
        if (permissionResolver) {
            cachedScopes = await permissionResolver()
            if (cachedScopes != null) GG_PERMISSIONS.set(new GGPermissionChecker(cachedScopes))

            if (connectPermission !== undefined && connectPermission !== GG_NO_PERMISSIONS) {
                if (cachedScopes == null || !satisfies(connectPermission, cachedScopes)) {
                    // The handshake already completed (HANDSHAKE_OK was sent), so we
                    // close the socket here. The client sees a normal disconnect.
                    // @TODO Plumb connectPermission into the handshake itself so the
                    // client receives a typed HANDSHAKE_ERR with NOT_AUTHORIZED/FORBIDDEN.
                    socket.close()
                    return
                }
            }
        }

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
                    const wrapped = required === GG_NO_PERMISSIONS || !permissionResolver
                        ? inner
                        : (data: any) => {
                            if (cachedScopes == null) {
                                return new GGPromise(Promise.resolve(new NOT_AUTHORIZED({
                                    debugMessage: `${schemaName}.${methodName} requires ${describePermission(required)} but no caller identity was resolved at handshake`
                                })))
                            }
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
        permissionResolver: config?.permissionResolver,
    });
}

function describePermission(p: unknown): string {
    if (typeof p === "symbol") {
        if (p === GG_NO_PERMISSIONS) return "GG_NO_PERMISSIONS"
        return "GG_ANY_PERMISSION"
    }
    if (typeof p === "string") return JSON.stringify(p)
    if (p && typeof p === "object") {
        if ("allOf" in p) return `allOf(${(p as any).allOf.map(describePermission).join(", ")})`
        if ("anyOf" in p) return `anyOf(${(p as any).anyOf.map(describePermission).join(", ")})`
    }
    return String(p)
}
