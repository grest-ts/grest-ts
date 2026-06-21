/**
 * Server extension for GGRawWebSocketSchema — adds startServer/register.
 * Node.js only.
 */

import type {GGRawSocket} from "../socket/GGRawSocket"
import {GGRawWebSocketSchema} from "../schema/GGRawWebSocketSchema"
import {type GGTransportMiddleware} from "@grest-ts/context"
import {GGSocketServer, type GGServerHeartbeatOption} from "./GGSocketServer"
import {GGLocator} from "@grest-ts/locator"
import {GG_HTTP_SERVER, GGHttpServer, GGHttpPermissionsChecker} from "@grest-ts/http"
import {GG_NO_PERMISSIONS} from "@grest-ts/schema"

export interface RawWebSocketSchemaConfig {
    http?: GGHttpServer;
    middlewares?: GGTransportMiddleware[];
    heartbeat?: GGServerHeartbeatOption;
}

declare module "../schema/GGRawWebSocketSchema" {
    interface GGRawWebSocketSchema<TQuery> {
        /**
         * Start the raw WebSocket server. The handshake (query validation + middleware/wire
         * auth + connect permission) runs first; `onConnection` then receives an authenticated
         * GGRawSocket and the validated query, and owns the byte stream from there.
         */
        startServer(
            onConnection: (socket: GGRawSocket, query: TQuery) => void | Promise<void>,
            config: RawWebSocketSchemaConfig
        ): GGSocketServer<unknown, TQuery, GGRawSocket>

        register(
            onConnection: (socket: GGRawSocket, query: TQuery) => void | Promise<void>,
            config?: RawWebSocketSchemaConfig
        ): void
    }
}

GGRawWebSocketSchema.prototype.startServer = function (
    this: GGRawWebSocketSchema<any>,
    onConnection: (socket: GGRawSocket, query: any) => void | Promise<void>,
    config: RawWebSocketSchemaConfig
): GGSocketServer<unknown, any, GGRawSocket> {
    const normalizedPath = this.path.startsWith('/') ? this.path : '/' + this.path
    const schemaName = this.name
    const middlewares: GGTransportMiddleware[] = [...this.middlewares, ...(config?.middlewares ?? [])]

    const http = config.http ?? GGLocator.getScope().get(GG_HTTP_SERVER)
    http._registerWebSocketSchema(this as any)
    const connectPermission = this.connectPermission ?? GG_NO_PERMISSIONS
    const permissionsChecker = new GGHttpPermissionsChecker(this.middlewares)

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
        queryValidator: this.queryValidator,
        heartbeat: config?.heartbeat,
        raw: true,
        customClient: this.customClient,
        protocols: this.protocols,
    })

    socketServer.onConnection(async (socket: GGRawSocket, queryArgs: any): Promise<void> => {
        await onConnection(socket, queryArgs)
    })

    return socketServer
}

GGRawWebSocketSchema.prototype.register = function (
    this: GGRawWebSocketSchema<any>,
    onConnection: (socket: GGRawSocket, query: any) => void | Promise<void>,
    config?: RawWebSocketSchemaConfig
): void {
    const http = config?.http ?? GGLocator.getScope().get(GG_HTTP_SERVER)
    if (!http) {
        throw new Error(`No HTTP server found. Make sure to register GGHttpServer in the scope or pass it via config`)
    }
    this.startServer(onConnection, {
        http,
        middlewares: config?.middlewares,
        heartbeat: config?.heartbeat,
    })
}
