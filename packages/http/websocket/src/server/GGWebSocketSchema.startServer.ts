/**
 * Server extension for GGWebSocketSchema — adds startServer.
 * This file should only be imported in server (Node.js) context.
 */

import type {GGSocket} from "../socket/GGSocket"
import {GGWebSocketSchema} from "../schema/GGWebSocketSchema";
import {type GGTransportMiddleware} from "@grest-ts/context";
import {GGSocketServer, type GGServerHeartbeatOption} from "./GGSocketServer";
import {GGLocator} from "@grest-ts/locator";
import {WebSocketIncoming, WebSocketOutgoing} from "../socket/WebSocketTypes";
import {GG_HTTP_SERVER, GGHttpServer} from "@grest-ts/http";
import {GGHttpPermissionsChecker} from "@grest-ts/http";
import {GG_NO_PERMISSIONS, GGContractClient, GGContractImplementation, GGDuplexContractDefinition} from "@grest-ts/schema";

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
    /**
     * Per-connection liveness heartbeat (server pings each client, reaps dead sockets).
     * On by default; pass `false` to disable or an object to tune interval/timeout/mode.
     */
    heartbeat?: GGServerHeartbeatOption;
}

export type GGWebSocketHandler<TDef extends GGDuplexContractDefinition> = (
    incoming: WebSocketIncoming<GGContractImplementation<TDef["clientToServer"]>>,
    outgoing: WebSocketOutgoing<GGContractClient<TDef["serverToClient"]>>,
    query: TDef["connect"] extends {input: {infer: infer Q}} ? Q : undefined
) => void

export function startWebSocketServer(
    schema: GGWebSocketSchema<any>,
    onConnection: any,
    config: WebSocketSchemaConfig
): GGSocketServer<any, any> {
    const contract = schema.contract
    const normalizedPath = schema.path.startsWith('/') ? schema.path : '/' + schema.path
    const schemaName = schema.name
    const http = config.http ?? GGLocator.getScope().get(GG_HTTP_SERVER);
    http._registerWebSocketSchema(schema as any);

    const connectMethod = contract.connect.method
    const connectPermission = connectMethod.permission ?? GG_NO_PERMISSIONS
    const permissionsChecker = new GGHttpPermissionsChecker(schema.middlewares);
    const middlewares: GGTransportMiddleware[] = [...schema.middlewares, ...(config?.middlewares ?? [])]
    // Gate the handshake: resolve scopes and assert connectPermission here so a failed
    // permission (or a throwing resolver) rejects the handshake. onConnection runs after
    // HANDSHAKE_OK, so a check there can't reject — it only re-snapshots scopes per-message.
    middlewares.push({
        async process() {
            await permissionsChecker.assert(schemaName, "", connectPermission)
        },
    })

    const socketServer = new GGSocketServer(http, {
        apiName: schemaName,
        path: normalizedPath,
        middlewares,
        queryValidator: connectMethod.input,
        heartbeat: config?.heartbeat,
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
                            permissionsChecker.assertGrants(schemaName, methodName, scopesOnConnection, required)
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
