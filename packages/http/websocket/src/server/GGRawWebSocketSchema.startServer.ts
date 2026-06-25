/**
 * Server extension for GGRawWebSocketSchema — adds startServer.
 * Node.js only.
 */

import type {GGRawSocket} from "../socket/GGRawSocket"
import {GGRawWebSocketSchema} from "../schema/GGRawWebSocketSchema"
import {type GGTransportMiddleware} from "@grest-ts/context"
import {GGSocketServer, type GGServerHeartbeatOption, type GGWsUpgrade} from "./GGSocketServer"
import {GGLocator} from "@grest-ts/locator"
import {GG_HTTP_SERVER, GGHttpServer, GGHttpPermissionsChecker} from "@grest-ts/http"
import {GG_NO_PERMISSIONS, GGRawSocketContractDefinition} from "@grest-ts/schema"

export interface RawWebSocketSchemaConfig {
    http?: GGHttpServer;
    middlewares?: GGTransportMiddleware[];
    heartbeat?: GGServerHeartbeatOption;
}

export type GGRawWebSocketHandler<TDef extends GGRawSocketContractDefinition> = (
    socket: GGRawSocket,
    query: TDef["connect"] extends {input: {infer: infer Q}} ? Q : undefined,
    upgrade: GGWsUpgrade
) => void | Promise<void>

export function startRawWebSocketServer(
    schema: GGRawWebSocketSchema<any>,
    onConnection: (socket: GGRawSocket, query: any, upgrade: GGWsUpgrade) => void | Promise<void>,
    config: RawWebSocketSchemaConfig
): GGSocketServer<unknown, any, GGRawSocket> {
    const normalizedPath = schema.path.startsWith('/') ? schema.path : '/' + schema.path
    const schemaName = schema.name
    const middlewares: GGTransportMiddleware[] = [...schema.middlewares, ...(config?.middlewares ?? [])]

    const http = config.http ?? GGLocator.getScope().get(GG_HTTP_SERVER)
    http._registerWebSocketSchema(schema as any)
    const connectMethod = schema.contract.connect.method
    const connectPermission = connectMethod.permission ?? GG_NO_PERMISSIONS
    const permissionsChecker = new GGHttpPermissionsChecker(schema.middlewares)

    // Gate the handshake: resolve scopes and assert connectPermission, so a failed
    // permission (or a throwing resolver) rejects the handshake before the stream opens.
    middlewares.push({
        async process() {
            await permissionsChecker.assert(schemaName, "", connectPermission)
        },
    })

    const socketServer = new GGSocketServer<unknown, any, GGRawSocket>(http, {
        apiName: schemaName,
        path: normalizedPath,
        middlewares,
        queryValidator: connectMethod.input,
        heartbeat: config?.heartbeat,
        raw: true,
        customClient: schema.customClient,
        protocols: schema.protocols,
    })

    socketServer.onConnection(async (socket: GGRawSocket, queryArgs: any, upgrade: GGWsUpgrade): Promise<void> => {
        await onConnection(socket, queryArgs, upgrade)
    })

    return socketServer
}
