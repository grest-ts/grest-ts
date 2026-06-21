/**
 * Client extension for GGRawWebSocketSchema — adds createRawClient.
 *
 * Mirrors the server: after the handshake (which runs the SAME middleware/wire auth as a
 * schema socket — the client sends credentials in the in-band handshake via each
 * middleware's `update()`), the connection is an opaque byte stream. Works in node and
 * the browser via the shared adapter.
 *
 * The client awaits HANDSHAKE_OK before exposing `send`, so the "wait for OK before
 * streaming" contract the server relies on (frames before OK are dropped) holds by
 * construction — callers never have to think about it.
 */

import {type GGTransportMiddleware} from "@grest-ts/context"
import {GGRawWebSocketSchema} from "../schema/rawSocketSchema"
import {SocketAdapter} from "../socket/SocketAdapter"
import {Message, MessageType} from "../socket/SocketMessage"
import {getDefaultAdapter} from "../adapter/getDefaultAdapter"
import {awaitHandshakeResponse, buildHandshakeHeaders, buildWsUrl, validateWsQuery} from "./clientHandshake"

export interface GGRawWebSocketClientConfig<TQuery = undefined> {
    /** WebSocket server URL, e.g. "ws://localhost:3000" (or "" for same-origin in the browser). */
    url: string
    /** Query parameters to include on connect; validated against the schema's `queryOnConnect`. */
    query?: TQuery
    /** Extra middlewares merged on top of the schema's, in order (e.g. a static auth token). */
    middlewares?: GGTransportMiddleware[]
    /** Handshake timeout in ms. Default 5000. */
    handshakeTimeoutMs?: number
}

/** A connected raw client socket — symmetric with the server-side GGRawSocket. */
export interface GGRawClientSocket {
    send(data: Uint8Array | string): void
    onMessage(handler: (data: Uint8Array) => void): this
    onClose(handler: () => void): this
    close(): void
}

export interface GGRawWebSocketClient {
    /** Open the socket, run the handshake (auth), and resolve once HANDSHAKE_OK arrives. */
    connect(): Promise<GGRawClientSocket>
}

declare module "../schema/rawSocketSchema" {
    interface GGRawWebSocketSchema<TQuery> {
        createRawClient(config: GGRawWebSocketClientConfig<TQuery>): GGRawWebSocketClient
    }
}

GGRawWebSocketSchema.prototype.createRawClient = function (
    this: GGRawWebSocketSchema<any>,
    config: GGRawWebSocketClientConfig<any>
): GGRawWebSocketClient {
    const normalizedPath = this.path.startsWith('/') ? this.path : '/' + this.path
    const queryValidator = this.queryValidator
    const middlewares: readonly GGTransportMiddleware[] = [...this.middlewares, ...(config.middlewares ?? [])]
    const handshakeTimeoutMs = config.handshakeTimeoutMs ?? 5000

    return {
        async connect(): Promise<GGRawClientSocket> {
            const validatedQuery = validateWsQuery(queryValidator, config.query)
            const url = buildWsUrl(config.url, normalizedPath, validatedQuery)

            // Build handshake headers in the CALLER's context (before any await), so
            // context-keyed credentials (CLIENT_AUTH_TOKEN etc.) resolve correctly.
            const headers = buildHandshakeHeaders(middlewares)

            const AdapterClass = await getDefaultAdapter()
            const adapter: SocketAdapter = new AdapterClass(url)

            adapter.onOpen(() => {
                adapter.send(Message.create(MessageType.HANDSHAKE, "", "", headers))
            })
            await awaitHandshakeResponse(adapter, handshakeTimeoutMs).catch((err) => {
                adapter.close()
                throw err
            })

            const socket: GGRawClientSocket = {
                send: (data) => adapter.sendRaw!(data),
                onMessage(handler) { adapter.onRawMessage!(handler); return this },
                onClose(handler) { adapter.onClose(handler); return this },
                close: () => adapter.close(),
            }
            return socket
        },
    }
}
