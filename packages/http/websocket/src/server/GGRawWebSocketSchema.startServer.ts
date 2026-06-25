/**
 * Server-side startRawWebSocketServer for GGRawWebSocketSchema. Node.js only.
 */

import type {GGRawSocket} from "../socket/GGRawSocket"
import {GGRawWebSocketSchema} from "../schema/GGRawWebSocketSchema"
import {GGSocketServer, type GGWsUpgrade} from "./GGSocketServer"
import {GGConnectQuery, GGRawSocketContractDefinition} from "@grest-ts/schema"
import {SocketServerConfig, prepareSocketServer} from "./prepareSocketServer"

export type GGRawWebSocketHandler<TDef extends GGRawSocketContractDefinition> = (
    socket: GGRawSocket,
    query: GGConnectQuery<TDef["connect"]>,
    upgrade: GGWsUpgrade
) => void | Promise<void>

export function startRawWebSocketServer(
    schema: GGRawWebSocketSchema<any>,
    onConnection: (socket: GGRawSocket, query: any, upgrade: GGWsUpgrade) => void | Promise<void>,
    config: SocketServerConfig
): GGSocketServer<any, GGRawSocket> {
    const {schemaName, normalizedPath, middlewares, queryValidator} = prepareSocketServer(schema, config)

    const socketServer = new GGSocketServer<any, GGRawSocket>(config.http, {
        apiName: schemaName,
        path: normalizedPath,
        middlewares,
        queryValidator,
        heartbeat: config.heartbeat,
        raw: true,
        customClient: schema.customClient,
        protocols: schema.protocols,
    })

    socketServer.onConnection(async (socket, queryArgs, upgrade): Promise<void> => {
        await onConnection(socket, queryArgs, upgrade)
    })

    return socketServer
}
