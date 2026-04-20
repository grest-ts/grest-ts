/**
 * Client extension for GGWebSocketSchema - adds createClient method.
 *
 * Mirrors the server's onConnection handler shape:
 *   - `incoming.on(handlers)`    — subscribe to serverToClient messages (Partial)
 *   - `outgoing.method(data)`    — call clientToServer methods (GGPromise)
 *   - `onClose` / `onError`      — connection lifecycle
 *   - `connect` / `disconnect`   — explicit lifecycle control
 *
 * Works in both browser and Node.js contexts.
 */

import {
    GGContractExecutor,
    GGContractMethod,
    GGPromise,
    SERVER_ERROR
} from "@grest-ts/schema"
import {GGWebSocketSchema} from "../schema/GGWebSocketSchema"
import {GGSocketPool} from "./GGSocketPool"
import {GGSocket} from "../socket/GGSocket"

export interface GGWebSocketClientConfig<TQuery = undefined> {
    /**
     * WebSocket server URL, e.g. "ws://localhost:3000".
     * If omitted, uses service discovery (requires @grest-ts/discovery).
     * In browser contexts, an explicit URL (or empty string for same-origin) is required.
     */
    url?: string
    /**
     * Query parameters to include on connect. Typed from `queryOnConnect<T>()` if used.
     * Appended to the connection URL as `?key=value`.
     */
    query?: TQuery
}

/**
 * Handler registry for server-pushed messages (serverToClient).
 * Accepts a Partial implementation — you only need to handle events you care about.
 */
export interface GGWebSocketIncoming<TServerToClientImpl> {
    /**
     * Register handlers for serverToClient messages.
     * May be called multiple times; later registrations override earlier ones per method.
     */
    on(handlers: Partial<TServerToClientImpl>): void
}

/**
 * Typed WebSocket client.
 *
 * Mirror of the server's connection handler:
 *   - `incoming.on(handlers)` registers handlers for serverToClient messages
 *   - `outgoing.method(data)` calls clientToServer methods
 *
 * Usage:
 * ```typescript
 * const client = ChatApi.createClient({ url: "ws://localhost:3000" })
 * client.incoming.on({
 *     newMessage:  (msg) => console.log(msg),
 *     areYouThere: async () => true,
 * })
 * await client.connect()
 * const res = await client.outgoing.sendMessage({ text: "hi", channelId: "general" })
 * client.outgoing.ping()  // fire-and-forget
 * client.onClose(() => { ... })
 * await client.disconnect()
 * ```
 */
export interface GGWebSocketClient<TClientToServer, TServerToClientImpl> {
    /**
     * Methods to call on the server (clientToServer).
     * Request-response methods return `GGPromise<Success, Errors>`.
     * Fire-and-forget methods return `GGPromise<void, SERVER_ERROR>`.
     */
    readonly outgoing: TClientToServer
    /**
     * Handler registry for server-pushed messages (serverToClient).
     */
    readonly incoming: GGWebSocketIncoming<TServerToClientImpl>
    /**
     * Establish the WebSocket connection.
     * Completes after the handshake succeeds. Must be called before `outgoing.*`.
     * Calling when already connected is a no-op.
     */
    connect(): Promise<void>
    /**
     * Gracefully close the connection — waits for pending outgoing requests to complete,
     * then closes the socket.
     */
    disconnect(): Promise<void>
    /**
     * Immediately close the connection without waiting for pending requests.
     */
    close(): void
    /**
     * Register a callback invoked when the connection closes (remotely or locally).
     */
    onClose(cb: () => void): this
    /**
     * Register a callback invoked on socket errors.
     */
    onError(cb: (error: Error) => void): this
    /**
     * True when the underlying socket is connected and the handshake has completed.
     */
    readonly isConnected: boolean
}

declare module "../schema/GGWebSocketSchema" {
    interface GGWebSocketSchema<
        TClientToServer,
        TServerToClient,
        TContext = {},
        TQuery = undefined,
        TClientToServerImpl = TClientToServer,
        TServerToClientImpl = TServerToClient
    > {
        /**
         * Create a typed client for this WebSocket API.
         *
         * The returned client mirrors the server's onConnection handler:
         *  - `client.incoming.on({...})` for serverToClient messages
         *  - `client.outgoing.method(...)` for clientToServer methods
         *
         * The client is created in a disconnected state. Register any handlers first,
         * then call `await client.connect()` before sending messages.
         */
        createClient(
            config?: GGWebSocketClientConfig<TQuery>
        ): GGWebSocketClient<TClientToServer, TServerToClientImpl>
    }
}

GGWebSocketSchema.prototype.createClient = function (
    this: GGWebSocketSchema<any, any, any, any, any, any>,
    config?: GGWebSocketClientConfig<any>
): GGWebSocketClient<any, any> {
    const contract = this.contract
    if (!contract) {
        throw new Error(`WebSocketSchema "${this.name}" has no contract.`)
    }

    const schemaName = this.name
    const normalizedPath = this.path.startsWith("/") ? this.path : "/" + this.path
    const middlewares = this.middlewares || []
    const clientToServerContract = contract.clientToServer
    const serverToClientContract = contract.serverToClient

    let socket: GGSocket | undefined
    const pendingHandlers: Record<string, (data: any) => any> = {}
    const pendingOnClose: Array<() => void> = []
    const pendingOnError: Array<(e: Error) => void> = []

    const resolveDomain = async (): Promise<string> => {
        if (config?.url !== undefined) {
            return config.url
        }
        try {
            const {GG_DISCOVERY} = await import(/* @vite-ignore */ "@grest-ts/discovery")
            return await GG_DISCOVERY.get().discoverApi(schemaName)
        } catch (err) {
            throw new SERVER_ERROR({
                displayMessage: "Service discovery failed for WebSocket API " + schemaName,
                originalError: err
            })
        }
    }

    const buildHandler = (methodName: string, userHandler: (data: any) => any) => {
        const contractFn = serverToClientContract.methods[methodName] as GGContractMethod
        if (!contractFn) {
            throw new Error(`Method "${methodName}" is not defined in serverToClient of "${schemaName}"`)
        }
        return (data: any) => new GGPromise(
            GGContractExecutor.call(contractFn, data, undefined, async (validated) => userHandler(validated))
        )
    }

    const outgoingImpl: Record<string, any> = {}
    for (const methodName of Object.keys(clientToServerContract.methods)) {
        const contractFn = clientToServerContract.methods[methodName] as GGContractMethod
        const hasResponse = contractFn.success !== undefined
        outgoingImpl[methodName] = async (data: any): Promise<any> => {
            if (!socket) {
                throw new SERVER_ERROR({
                    displayMessage: "WebSocket client is not connected. Call connect() first."
                })
            }
            return socket.send(`${schemaName}.${methodName}`, data, hasResponse)
        }
    }
    const outgoing = clientToServerContract.implement(outgoingImpl as any)

    const client: GGWebSocketClient<any, any> = {
        outgoing,
        incoming: {
            on(handlers: Record<string, any>) {
                for (const methodName of Object.keys(handlers)) {
                    const userHandler = handlers[methodName]
                    if (!userHandler) continue
                    const wrapped = buildHandler(methodName, userHandler)
                    const path = `${schemaName}.${methodName}`
                    if (socket) {
                        socket.registerHandler({path, handler: wrapped})
                    } else {
                        pendingHandlers[path] = wrapped
                    }
                }
            }
        },

        async connect(): Promise<void> {
            if (socket) return
            const domain = await resolveDomain()
            // Use non-pooled connect: each client owns its socket + close lifecycle.
            socket = await GGSocketPool.connect({
                domain,
                path: normalizedPath,
                query: config?.query,
                middlewares
            })
            for (const path of Object.keys(pendingHandlers)) {
                socket.registerHandler({path, handler: pendingHandlers[path]})
            }
            for (const cb of pendingOnClose) socket.onClose(cb)
            for (const cb of pendingOnError) socket.onError(cb)
            socket.onClose(() => {
                socket = undefined
            })
        },

        async disconnect(): Promise<void> {
            if (socket) {
                const s = socket
                socket = undefined
                await s.teardown()
            }
        },

        close(): void {
            if (socket) {
                const s = socket
                socket = undefined
                s.close()
            }
        },

        onClose(cb: () => void): any {
            if (socket) socket.onClose(cb)
            else pendingOnClose.push(cb)
            return this
        },

        onError(cb: (e: Error) => void): any {
            if (socket) socket.onError(cb)
            else pendingOnError.push(cb)
            return this
        },

        get isConnected(): boolean {
            return socket !== undefined
        }
    }

    return client
}
