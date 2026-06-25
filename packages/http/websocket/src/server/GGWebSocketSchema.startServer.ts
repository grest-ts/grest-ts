/**
 * Server-side startWebSocketServer for GGWebSocketSchema. Node.js only.
 */

import type {GGSocket} from "../socket/GGSocket"
import {GGWebSocketSchema} from "../schema/GGWebSocketSchema";
import {GGSocketServer} from "./GGSocketServer";
import {WebSocketIncoming, WebSocketOutgoing} from "../socket/WebSocketTypes";
import {GGConnectQuery, GGContractClient, GGContractImplementation, GGDuplexContractDefinition} from "@grest-ts/schema";
import {SocketServerConfig, prepareSocketServer} from "./prepareSocketServer";

export type GGWebSocketHandler<TDef extends GGDuplexContractDefinition> = (
    incoming: WebSocketIncoming<GGContractImplementation<TDef["clientToServer"]>>,
    outgoing: WebSocketOutgoing<GGContractClient<TDef["serverToClient"]>>,
    query: GGConnectQuery<TDef["connect"]>
) => void

export function startWebSocketServer(
    schema: GGWebSocketSchema<any>,
    onConnection: any,
    config: SocketServerConfig
): GGSocketServer<any> {
    const contract = schema.contract
    const {schemaName, normalizedPath, middlewares, permissionsChecker, connectPermission, queryValidator} = prepareSocketServer(schema, config)

    const socketServer = new GGSocketServer(config.http, {
        apiName: schemaName,
        path: normalizedPath,
        middlewares,
        queryValidator,
        heartbeat: config.heartbeat,
    });

    socketServer.onConnection(async (socket: GGSocket, queryArgs: any): Promise<void> => {
        const clientToServerContract = contract.clientToServer
        const serverToClientContract = contract.serverToClient
        const scopesOnConnection = await permissionsChecker.assert(schemaName, "", connectPermission)
        const incoming: any = {
            on(handlers: any) {
                const impl: Record<string, any> = {};
                for (const methodName of Object.keys(clientToServerContract.methods)) {
                    impl[methodName] = (data: any) => handlers[methodName](data);
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
