/**
 * Server extension for GGRawWebSocketSchema — adds startServer/register.
 * Node.js only.
 */

import type {GGRawSocket} from "../socket/GGRawSocket"
import {GGRawWebSocketSchema} from "../schema/rawSocketSchema"
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

declare module "../schema/rawSocketSchema" {
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

    // Passthrough auth runs against the HTTP upgrade request — there is no in-band handshake.
    // A middleware with update() delivers its credential by having the grest-ts CLIENT write it
    // into the handshake (the "fake header" path); a foreign passthrough client never does that,
    // so the credential can't arrive and the socket would open UNAUTHENTICATED while looking gated.
    // Fail loudly at registration rather than silently. Read the upgrade cookie/query/header with a
    // parse-only middleware instead.
    if (this.passthrough) {
        const offender = middlewares.find(m => typeof m.update === "function")
        if (offender) {
            throw new Error(
                `rawSocketSchema "${schemaName}": passthrough mode cannot use a credential delivered via ` +
                `the grest-ts handshake (a middleware/wire with update(), e.g. GGHeader). A passthrough client ` +
                `is foreign and never sends the in-band handshake, so this credential would never arrive and the ` +
                `socket could open unauthenticated. Authenticate via a cookie or "?query=" credential (a parse-only ` +
                `middleware) instead, or remove passthrough.`
            )
        }
    }

    const http = config.http ?? GGLocator.getScope().get(GG_HTTP_SERVER)
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
        passthrough: this.passthrough,
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
