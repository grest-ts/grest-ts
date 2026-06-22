/**
 * Client extension for GGWebSocketSchema - adds createClient method.
 *
 * Mirrors the server's onConnection handler exactly:
 *
 *   server: ChatApi.register((incoming, outgoing) => {
 *       incoming.on({ ... })
 *   })
 *
 *   client: const client = ChatApi.createClient({ url })
 *           await client.connect(({incoming, outgoing}) => {
 *               incoming.on({ ... })
 *           })
 *           await client.outgoing.xxx(...)
 *
 * The setup callback is the single place that wires handlers. It is re-run on
 * every successful (re)connection, so auto-reconnect produces a fully-rewired
 * client without any persistent-handler state to go stale.
 *
 * Works in both browser and Node.js contexts.
 */

import {
    GGContractExecutor,
    GGContractMethod,
    GGPromise,
    SERVER_ERROR,
} from "@grest-ts/schema"
import {GGWebSocketSchema} from "../schema/GGWebSocketSchema"
import {GGSocketPool} from "./GGSocketPool"
import {GGSocket, type GGHeartbeatConfig} from "../socket/GGSocket"
import type {GGTransportMiddleware} from "@grest-ts/context";
import {GGWsLogMode} from "./GGWsLogMode"
import {validateWsQuery} from "./clientHandshake"
import {log} from "./wsLog"
import {
    createConnector,
    normalizeReconnect,
    type GGConnectParams,
    type GGReconnectConfig,
    type GGWebSocketCloseReason,
} from "./reconnectConnector"
import {resolveWsDomain} from "./wsDiscovery"

export type {GGHeartbeatConfig}
export type {GGConnectParams}
export type {GGReconnectConfig, GGWebSocketCloseReason}

/** Behaviour config common to both connection-param modes (static and beforeConnect). */
export interface GGWebSocketClientOptions {
    /**
     * Default timeout in ms for request/response outgoing calls. Defaults to 30 000.
     * Fire-and-forget methods ignore this.
     */
    timeout?: number
    /**
     * Auto-reconnect on unexpected drops. Default on (with backoff + liveness).
     * Pass an object to tune, or `false` to disable.
     * Manual `disconnect()` / `close()` always wins over reconnect.
     */
    reconnect?: boolean | GGReconnectConfig
    /**
     * Wire-log verbosity. `ALL` (default) logs every frame and lifecycle
     * transition; `NON_OK` logs only sketchy outcomes; `OFF` is silent
     * (fast path — no entry construction). Static for the client lifetime.
     */
    logMode?: GGWsLogMode
}

/**
 * Connection params come from exactly ONE of two mutually-exclusive sources (the union below
 * makes mixing them a compile error — you can't set both static fields and `beforeConnect`):
 *
 * - static: `url` / `query` / `middlewares`, captured once. For fixed connection params.
 * - dynamic: `beforeConnect`, resolved before every connect attempt. For short-lived / rotating
 *   credentials (a freshly minted token, a signed URL) — it returns the complete `url` / `query` /
 *   `middlewares` each attempt, so they're never stale. Schema `.use()` wires apply on top of both.
 */
export type GGWebSocketClientConfig<TQuery = undefined> = GGWebSocketClientOptions & (
    | {
        /**
         * WebSocket server URL, e.g. "ws://localhost:3000". If omitted, uses service discovery
         * (requires @grest-ts/discovery). In browsers, pass an explicit URL (or "" for same-origin).
         */
        url?: string
        /**
         * Query parameters to include on connect. Typed from `queryOnConnect<T>()` if used; validated
         * against the schema's query validator before connecting.
         */
        query?: TQuery
        /**
         * Extra middlewares on top of the schema's, in order — per-client concerns (e.g. a static
         * auth token). For a credential that *refreshes*, prefer a context-key wire (auto-fresh on
         * reconnect) or `beforeConnect`.
         */
        middlewares?: GGTransportMiddleware[]
        beforeConnect?: never
    }
    | {
        /**
         * Resolve the volatile connection params before EVERY connect attempt (first connect and
         * every reconnect). Returns the complete `url` / `query` / `middlewares` for that attempt;
         * the static fields above cannot be combined with it. Schema `.use()` wires apply on top.
         *
         * Runs inside the connect path: a throw is a failed attempt fed to `shouldRetry` (a transient
         * mint failure backs off; `NOT_AUTHORIZED` / `FORBIDDEN` / `VALIDATION_ERROR` are terminal).
         * The returned query is validated every attempt.
         */
        beforeConnect: () => GGConnectParams<TQuery> | Promise<GGConnectParams<TQuery>>
        url?: never
        query?: never
        middlewares?: never
    }
)

export interface GGWebSocketSetupTools<TServerToClientImpl, TClientToServer> {
    incoming: {
        /**
         * Register handlers for serverToClient messages.
         * Partial — register only methods you care about.
         */
        on(handlers: Partial<TServerToClientImpl>): void
    }
    outgoing: TClientToServer
}

/**
 * Setup callback — receives handler registration tools + outgoing methods.
 * Re-invoked on every successful (re)connection; keep it pure wrt setup actions.
 *
 * For correctness: register incoming handlers synchronously at the top of the
 * callback (before any `await`), so no pushed message can slip through before
 * handlers exist.
 */
export type GGWebSocketSetup<TServerToClientImpl, TClientToServer> = (
    tools: GGWebSocketSetupTools<TServerToClientImpl, TClientToServer>
) => void | Promise<void>

export interface GGWebSocketClient<TClientToServer, TServerToClientImpl> {
    /**
     * Methods to call on the server (clientToServer).
     * Throws `SERVER_ERROR` synchronously if called before connect().
     */
    readonly outgoing: TClientToServer

    /** True when a socket is connected and the handshake has completed. */
    readonly isConnected: boolean

    /**
     * Establish the connection and run the setup callback.
     * If `reconnect` is enabled, the callback is re-invoked on every successful
     * reconnection, so handlers + initial outgoing calls rebuild the full state.
     */
    connect(setup?: GGWebSocketSetup<TServerToClientImpl, TClientToServer>): Promise<void>

    /**
     * Gracefully close. Disables further auto-reconnect and drains pending calls.
     */
    disconnect(): Promise<void>

    /**
     * Immediately close. Disables further auto-reconnect.
     */
    close(): void

    /**
     * Fires once, when the client has stopped reconnecting.
     * The `reason` identifies why; for terminal/error cases `error` carries the cause.
     */
    onClose(cb: (reason: GGWebSocketCloseReason, error?: Error) => void): this

    /**
     * Fires on every socket drop (before any reconnect attempt).
     * `"manual"` = user called disconnect/close; `"drop"` = unexpected.
     */
    onDisconnect(cb: (reason: "manual" | "drop") => void): this

    /**
     * Fires on socket errors. Multiple events possible per connection lifetime.
     */
    onError(cb: (error: Error) => void): this

    /**
     * Drop the current socket as if it had been lost, triggering the auto-reconnect
     * loop (unlike `close()`/`disconnect()`, which disable reconnect). Use when the
     * app knows the connection is stale — e.g. on `visibilitychange`/`online`, or
     * from a liveness watchdog. No-op if reconnect is disabled or already closed.
     */
    forceReconnect(): void
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
    const schemaMiddlewares = this.middlewares || []
    const queryValidator = this.queryValidator
    const clientToServerContract = contract.clientToServer
    const serverToClientContract = contract.serverToClient
    const timeout = config?.timeout ?? 30_000
    const logMode = config?.logMode ?? GGWsLogMode.ALL

    // Outgoing — stable object; methods throw if called before/after connect.
    const outgoingImpl: Record<string, any> = {}
    for (const methodName of Object.keys(clientToServerContract.methods)) {
        const contractFn = clientToServerContract.methods[methodName] as GGContractMethod
        const hasResponse = contractFn.success !== undefined
        outgoingImpl[methodName] = async (data: any): Promise<any> => {
            const socket = connector.current()
            if (!socket) {
                throw new SERVER_ERROR({
                    displayMessage: "WebSocket client is not connected. Call connect() first.",
                })
            }
            logMode === GGWsLogMode.ALL && log.info(schemaName, `ws→ ${schemaName}.${methodName}`, {kind: "outgoing", methodName, payload: data})
            return socket.send(`${schemaName}.${methodName}`, data, hasResponse, timeout)
        }
    }
    const outgoing = clientToServerContract.implement(outgoingImpl as any, {skipLocatorRegistration: true})

    const buildSetupTools = (s: GGSocket): GGWebSocketSetupTools<any, any> => ({
        incoming: {
            on(handlers: Record<string, any>) {
                for (const methodName of Object.keys(handlers)) {
                    const userHandler = handlers[methodName]
                    if (!userHandler) continue
                    const contractFn = serverToClientContract.methods[methodName] as GGContractMethod
                    if (!contractFn) {
                        throw new Error(`Method "${methodName}" is not defined in serverToClient of "${schemaName}"`)
                    }
                    const wrapped = (data: any) => {
                        logMode === GGWsLogMode.ALL && log.info(schemaName, `ws← ${schemaName}.${methodName}`, {kind: "incoming", methodName, payload: data})
                        return new GGPromise(
                            GGContractExecutor.call(contractFn, data, undefined, async (validated) => userHandler(validated))
                        )
                    }
                    s.registerHandler({path: `${schemaName}.${methodName}`, handler: wrapped})
                }
            },
        },
        outgoing,
    })

    let savedSetup: GGWebSocketSetup<any, any> | undefined

    const connector = createConnector<GGSocket>({
        schemaName,
        logMode,
        reconnect: normalizeReconnect(config?.reconnect),
        open: async () => {
            // Must resolve per-attempt here, never captured at createClient time — that is what
            // keeps a rotating credential fresh across reconnects.
            const fresh = config?.beforeConnect ? await config.beforeConnect() : undefined
            const url = fresh ? fresh.url : config?.url
            const query = fresh ? fresh.query : config?.query
            const clientMiddlewares = fresh ? fresh.middlewares : config?.middlewares
            const domain = await resolveWsDomain(url, schemaName)
            return GGSocketPool.connect({
                domain,
                path: normalizedPath,
                query: validateWsQuery(queryValidator, query),
                middlewares: [...schemaMiddlewares, ...(clientMiddlewares ?? [])],
            })
        },
        setup: async (s) => {
            if (savedSetup) await savedSetup(buildSetupTools(s))
        },
    })

    const client: GGWebSocketClient<any, any> = {
        outgoing,
        get isConnected(): boolean { return connector.isConnected() },
        async connect(setup?: GGWebSocketSetup<any, any>): Promise<void> {
            if (connector.isConnected()) return
            savedSetup = setup
            await connector.connect()
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
