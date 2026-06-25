/**
 * Client extension for GGRawWebSocketSchema — adds createClient (the byte-stream client).
 *
 * Symmetric with the typed client: same handshake (in-band auth via each middleware's
 * `update()`), same reconnect + liveness connector — but the payload is opaque bytes, so
 * the surface is `send` / `onMessage` instead of a typed contract. `onMessage` handlers
 * persist across reconnects (re-registered on every fresh socket), and `send` targets the
 * live socket. Works in node and the browser via the shared adapter.
 *
 * customClient schemas have no client here — their client is foreign by definition.
 */

import {GGConnectQuery, GGRawSocketContractDefinition, SERVER_ERROR} from "@grest-ts/schema"
import {GGRawWebSocketSchema} from "../schema/GGRawWebSocketSchema"
import {GGRawSocket} from "../socket/GGRawSocket"
import type {GGHeartbeatConfig} from "../socket/GGSocket"
import {getDefaultAdapter} from "../adapter/getDefaultAdapter"
import {buildWsUrl, openClientConnection, validateWsQuery} from "./clientHandshake"
import {
    createConnector,
    normalizeReconnect,
    resolveConnectParams,
    type GGConnectParams,
    type GGWsConnectSource,
    type GGReconnectConfig,
    type GGWebSocketCloseReason,
} from "./reconnectConnector"
import {resolveWsDomain} from "./wsDiscovery"
import {GGWsLogMode} from "./GGWsLogMode"

export type {GGHeartbeatConfig}
export type {GGConnectParams}

/** Behaviour config common to both connection-param modes (static and beforeConnect). */
export interface GGRawWebSocketClientOptions {
    /**
     * Auto-reconnect on unexpected drops. Default on (with backoff + liveness).
     * Pass an object to tune, or `false` to disable. A reconnected byte stream is a fresh
     * stream — bytes sent while it was down are not replayed.
     */
    reconnect?: boolean | GGReconnectConfig
    /** Wire-log verbosity. `ALL` (default) / `NON_OK` / `OFF`. */
    logMode?: GGWsLogMode
    /** Handshake timeout in ms. Default 5000. */
    handshakeTimeoutMs?: number
}

export type GGRawWebSocketClientConfig<TQuery = undefined> = GGRawWebSocketClientOptions & GGWsConnectSource<TQuery>

export interface GGRawWebSocketClient {
    /** True when the socket is connected and the handshake has completed. */
    readonly isConnected: boolean

    /** Open the socket, run the handshake (auth), and resolve once HANDSHAKE_OK arrives. */
    connect(): Promise<void>

    /** Send an opaque frame. Throws `SERVER_ERROR` if called before connect(). */
    send(data: Uint8Array | string): void

    /** Register an inbound-frame handler (`isBinary` = the WebSocket frame type). Persists across reconnects. */
    onMessage(handler: (data: Uint8Array, isBinary: boolean) => void): this

    /** Gracefully close. Disables further auto-reconnect. */
    disconnect(): Promise<void>

    /** Immediately close. Disables further auto-reconnect. */
    close(): void

    /** Fires once, when the client has stopped reconnecting. */
    onClose(cb: (reason: GGWebSocketCloseReason, error?: Error) => void): this

    /** Fires on every socket drop (before any reconnect attempt). */
    onDisconnect(cb: (reason: "manual" | "drop") => void): this

    /** Fires on socket errors. */
    onError(cb: (error: Error) => void): this

    /** Drop the current socket to trigger the reconnect loop (no-op if reconnect is off). */
    forceReconnect(): void
}

declare module "../schema/GGRawWebSocketSchema" {
    interface GGRawWebSocketSchema<TDef> {
        createClient(
            config?: GGRawWebSocketClientConfig<GGConnectQuery<(TDef & GGRawSocketContractDefinition)["connect"]>>
        ): GGRawWebSocketClient
    }
}

GGRawWebSocketSchema.prototype.createClient = function (
    this: GGRawWebSocketSchema<any>,
    config?: GGRawWebSocketClientConfig<any>
): GGRawWebSocketClient {
    const schemaName = this.name
    const normalizedPath = this.path.startsWith("/") ? this.path : "/" + this.path
    const schemaMiddlewares = this.middlewares
    const queryValidator = this.contract.connect.method.input
    const logMode = config?.logMode ?? GGWsLogMode.ALL
    const handshakeTimeoutMs = config?.handshakeTimeoutMs ?? 5000

    const messageHandlers: Array<(data: Uint8Array, isBinary: boolean) => void> = []

    const connector = createConnector<GGRawSocket>({
        schemaName,
        logMode,
        reconnect: normalizeReconnect(config?.reconnect),
        open: async () => {
            // Resolve per-attempt (never captured at createClient time) — that is what keeps a
            // rotating credential fresh across reconnects.
            const params = await resolveConnectParams(config)
            const domain = await resolveWsDomain(params.url, schemaName)
            const url = buildWsUrl(domain, normalizedPath, validateWsQuery(queryValidator, params.query))
            const AdapterClass = await getDefaultAdapter()
            return openClientConnection({
                adapter: new AdapterClass(url),
                domain,
                middlewares: [...schemaMiddlewares, ...(params.middlewares ?? [])],
                contextName: "ws-raw-client-connection",
                handshakeTimeoutMs,
                makeSocket: (adapter, context) => new GGRawSocket(adapter, {
                    apiName: schemaName,
                    socketPath: normalizedPath,
                    connectionContext: context,
                }),
            })
        },
        setup: (socket) => {
            for (const handler of messageHandlers) socket.onMessage(handler)
        },
    })

    const client: GGRawWebSocketClient = {
        get isConnected(): boolean { return connector.isConnected() },
        connect: () => connector.connect(),
        send(data: Uint8Array | string): void {
            const socket = connector.current()
            if (!socket) {
                throw new SERVER_ERROR({
                    displayMessage: "WebSocket client is not connected. Call connect() first.",
                })
            }
            socket.send(data)
        },
        onMessage(handler: (data: Uint8Array, isBinary: boolean) => void): any {
            messageHandlers.push(handler)
            const socket = connector.current()
            if (socket) socket.onMessage(handler)
            return this
        },
        disconnect: () => connector.disconnect(),
        close: () => connector.close(),
        onClose(cb): any { connector.onClose(cb); return this },
        onDisconnect(cb): any { connector.onDisconnect(cb); return this },
        onError(cb): any { connector.onError(cb); return this },
        forceReconnect: () => connector.forceReconnect(),
    }

    return client
}
