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
 *
 * ## Pooling
 *
 * By default, clients sharing the same URL + auth headers share one physical
 * WebSocket connection. Each client registers its own setup hook; all hooks
 * re-run on reconnect. Disconnect one client and only its handlers are removed;
 * the connection stays alive for the others. Pass `{dedicated: true}` to opt
 * out and get an exclusive connection with independent lifecycle control.
 */

import {
    GGContractExecutor,
    GGContractMethod,
    GGPromise,
    SERVER_ERROR,
} from "@grest-ts/schema"
import {GGWebSocketSchema} from "../schema/GGWebSocketSchema"
import {GGSocketPool, GGPoolEntry} from "./GGSocketPool"
import {GGSocket, type GGHeartbeatConfig} from "../socket/GGSocket"
import {GGWsLogMode} from "./GGWsLogMode"
import {validateWsQuery} from "./clientHandshake"
import {log} from "./wsLog"
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
    /**
     * When true, opens a dedicated connection that is not shared with other
     * clients at the same URL. Use when you need independent lifecycle control,
     * custom reconnect settings, or multiple instances of the same contract at
     * the same URL. Defaults to false (pooled).
     */
    dedicated?: boolean
}

export type GGWebSocketClientConfig<TQuery = undefined> = GGWebSocketClientOptions & GGWsConnectSource<TQuery>

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
    const dedicated = config?.dedicated === true

    // Mutable socket getter — set to the right source once the connection path is known.
    let getActiveSocket: () => GGSocket | undefined = () => undefined

    const outgoingImpl: Record<string, any> = {}
    for (const methodName of Object.keys(clientToServerContract.methods)) {
        const contractFn = clientToServerContract.methods[methodName] as GGContractMethod
        const hasResponse = contractFn.success !== undefined
        outgoingImpl[methodName] = async (data: any): Promise<any> => {
            const socket = getActiveSocket()
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

    const buildSetupTools = (s: GGSocket, pooled: boolean): GGWebSocketSetupTools<any, any> => ({
        incoming: {
            on(handlers: Record<string, any>) {
                for (const methodName of Object.keys(handlers)) {
                    const userHandler = handlers[methodName]
                    if (!userHandler) continue
                    const contractFn = serverToClientContract.methods[methodName] as GGContractMethod
                    if (!contractFn) {
                        throw new Error(`Method "${methodName}" is not defined in serverToClient of "${schemaName}"`)
                    }
                    const path = `${schemaName}.${methodName}`
                    if (pooled && s.hasHandler(path)) {
                        throw new Error(
                            `Handler "${path}" is already registered on this pooled socket. ` +
                            `Only one instance of "${schemaName}" can share a connection at the same URL. ` +
                            `Use {dedicated: true} if you need multiple independent clients.`
                        )
                    }
                    const wrapped = (data: any) => {
                        logMode === GGWsLogMode.ALL && log.info(schemaName, `ws← ${schemaName}.${methodName}`, {kind: "incoming", methodName, payload: data})
                        return new GGPromise(
                            GGContractExecutor.call(contractFn, data, undefined, async (validated) => userHandler(validated))
                        )
                    }
                    s.registerHandler({path, handler: wrapped})
                }
            },
        },
        outgoing,
    })

    // -------------------------------------------------------------------------
    // Dedicated path — one exclusive socket per client, existing behaviour.
    // -------------------------------------------------------------------------
    if (dedicated) {
        let savedSetup: GGWebSocketSetup<any, any> | undefined

        const connector = createConnector<GGSocket>({
            schemaName,
            logMode,
            reconnect: normalizeReconnect(config?.reconnect),
            open: async () => {
                const {url, query, middlewares} = await resolveConnectParams(config)
                const domain = await resolveWsDomain(url, schemaName)
                return GGSocketPool.connect({
                    domain,
                    path: normalizedPath,
                    query: validateWsQuery(queryValidator, query),
                    middlewares: [...schemaMiddlewares, ...(middlewares ?? [])],
                })
            },
            setup: async (s) => {
                if (savedSetup) await savedSetup(buildSetupTools(s, false))
            },
        })

        getActiveSocket = () => connector.current()

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

    // -------------------------------------------------------------------------
    // Pooled path — shared connection, keyed on URL + auth headers.
    // -------------------------------------------------------------------------
    const clientId = Symbol()
    let poolEntry: GGPoolEntry | undefined
    let poolKey: string | undefined
    let poolConnected = false
    let finallyDisconnected = false
    let savedSetup: GGWebSocketSetup<any, any> | undefined

    const onCloseCallbacks: Array<(reason: GGWebSocketCloseReason, error?: Error) => void> = []
    const onDisconnectCallbacks: Array<(reason: "manual" | "drop") => void> = []
    const onErrorCallbacks: Array<(error: Error) => void> = []

    getActiveSocket = () => poolEntry?.current()

    const client: GGWebSocketClient<any, any> = {
        outgoing,
        get isConnected(): boolean { return poolEntry?.isConnected() ?? false },

        async connect(setup?: GGWebSocketSetup<any, any>): Promise<void> {
            if (finallyDisconnected) {
                throw new SERVER_ERROR({
                    displayMessage: "WebSocket client has been closed and cannot be reconnected. Create a new client.",
                })
            }
            if (poolConnected) return
            savedSetup = setup

            const {url, query, middlewares} = await resolveConnectParams(config)
            const domain = await resolveWsDomain(url, schemaName)
            const poolConfig = {
                domain,
                path: normalizedPath,
                query: validateWsQuery(queryValidator, query),
                middlewares: [...schemaMiddlewares, ...(middlewares ?? [])],
            }

            const key = await GGSocketPool.buildKey(poolConfig)
            const entry = GGSocketPool.getOrCreateEntry(poolConfig, key)

            // Set poolEntry before attach so outgoing calls inside the setup
            // callback (e.g. initial subscribe) can resolve the live socket.
            poolEntry = entry
            poolKey = key

            entry.registerDisconnect(clientId, (reason) => {
                for (const cb of onDisconnectCallbacks) try { cb(reason) } catch (_) {}
            })
            entry.registerClose(clientId, (reason, error) => {
                for (const cb of onCloseCallbacks) try { cb(reason as GGWebSocketCloseReason, error) } catch (_) {}
            })
            entry.registerError(clientId, (error) => {
                for (const cb of onErrorCallbacks) try { cb(error) } catch (_) {}
            })

            await entry.attach(clientId, async (socket) => {
                if (savedSetup) await savedSetup(buildSetupTools(socket, true))
            })

            poolConnected = true
        },

        async disconnect(): Promise<void> {
            if (!poolKey || finallyDisconnected) return
            finallyDisconnected = true
            GGSocketPool.detach(poolKey, clientId, schemaName + ".", true)
            poolEntry = undefined
            for (const cb of onDisconnectCallbacks) try { cb("manual") } catch (_) {}
            for (const cb of onCloseCallbacks) try { cb("manual", undefined) } catch (_) {}
        },

        close(): void {
            if (!poolKey || finallyDisconnected) return
            finallyDisconnected = true
            GGSocketPool.detach(poolKey, clientId, schemaName + ".", false)
            poolEntry = undefined
            for (const cb of onDisconnectCallbacks) try { cb("manual") } catch (_) {}
            for (const cb of onCloseCallbacks) try { cb("manual", undefined) } catch (_) {}
        },

        onClose(cb): any { onCloseCallbacks.push(cb); return this },
        onDisconnect(cb): any { onDisconnectCallbacks.push(cb); return this },
        onError(cb): any { onErrorCallbacks.push(cb); return this },
        forceReconnect(): void { poolEntry?.forceReconnect() },
    }

    return client
}
