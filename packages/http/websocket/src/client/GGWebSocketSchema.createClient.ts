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
    FORBIDDEN,
    GGContractExecutor,
    GGContractMethod,
    GGPromise,
    NOT_AUTHORIZED,
    SERVER_ERROR,
    VALIDATION_ERROR,
} from "@grest-ts/schema"
import {GGWebSocketSchema} from "../schema/GGWebSocketSchema"
import {GGSocketPool} from "./GGSocketPool"
import {GGSocket, type GGHeartbeatConfig} from "../socket/GGSocket"
import type {GGTransportMiddleware} from "@grest-ts/context";
import {GGWsLogMode} from "./GGWsLogMode"

export type {GGHeartbeatConfig}

export interface GGReconnectConfig {
    /** First retry delay. Default 500 ms. */
    initialDelayMs?: number
    /** Delay cap for exponential backoff. Default 30 000 ms. */
    maxDelayMs?: number
    /** Backoff multiplier. Default 2. */
    multiplier?: number
    /** Give up after this many consecutive failures. Default Infinity. */
    maxAttempts?: number
    /**
     * Predicate deciding whether an error during a reconnect attempt should
     * trigger another retry. Default: retry on any error EXCEPT NOT_AUTHORIZED
     * and FORBIDDEN — those are treated as permanent and fire a final onClose
     * with reason "unrecoverable". Return true to retry, false to give up.
     */
    shouldRetry?: (error: Error) => boolean
    /**
     * Dead-connection detection via PING/PONG. On by default when reconnect is enabled:
     * a missed heartbeat drops the socket and reconnects, so a half-open link self-heals
     * (works in the browser too). Pass `false` to disable, or an object to tune.
     */
    heartbeat?: GGHeartbeatConfig | false
}

export interface GGWebSocketClientConfig<TQuery = undefined> {
    /**
     * WebSocket server URL, e.g. "ws://localhost:3000".
     * If omitted, uses service discovery (requires @grest-ts/discovery).
     * In browsers, pass an explicit URL (or "" for same-origin).
     */
    url?: string
    /**
     * Query parameters to include on connect. Typed from `queryOnConnect<T>()` if used.
     * If the schema declares a query validator, it's applied here before connecting.
     */
    query?: TQuery
    /**
     * Extra middlewares merged on top of the schema's middlewares, in order.
     * Use this to attach per-client concerns (e.g. a static auth token) without
     * requiring callers to set up a GGContext around connect(). Manual
     * header manipulation is intentionally not exposed — middleware is the API.
     */
    middlewares?: GGTransportMiddleware[]
    /**
     * Default timeout in ms for request/response outgoing calls. Defaults to 30 000.
     * Fire-and-forget methods ignore this.
     */
    timeout?: number
    /**
     * Auto-reconnect on unexpected drops. Default off.
     * `true` enables with defaults; pass an object to tune.
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

/**
 * Reason the client was finally closed (no further reconnects will happen).
 *
 *  - "manual"            — user called disconnect()/close()
 *  - "drop"              — socket dropped and reconnect is disabled
 *  - "retries-exhausted" — reconnect enabled, hit maxAttempts
 *  - "unrecoverable"     — reconnect skipped due to shouldRetry returning false
 *                          (default: NOT_AUTHORIZED / FORBIDDEN)
 */
export type GGWebSocketCloseReason = "manual" | "drop" | "retries-exhausted" | "unrecoverable"

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

interface NormalizedReconnect {
    initialDelayMs: number
    maxDelayMs: number
    multiplier: number
    maxAttempts: number
    shouldRetry: (error: Error) => boolean
    heartbeat?: GGHeartbeatConfig
}

/** Default: don't retry if the server said "auth" — re-trying won't help. */
const defaultShouldRetry = (err: Error): boolean => {
    if (err instanceof NOT_AUTHORIZED) return false
    if (err instanceof FORBIDDEN) return false
    return true
}

const log = {
    info: (name: string, msg: string, data?: unknown) => console.info(`[${name}]`, msg, data),
    warn: (name: string, msg: string, data?: unknown) => console.warn(`[${name}]`, msg, data),
    error: (name: string, msg: string, errorOrData?: unknown, data?: unknown) =>
        console.error(`[${name}]`, msg, errorOrData, data),
}

function normalizeReconnect(r: boolean | GGReconnectConfig | undefined): NormalizedReconnect | null {
    if (!r) return null
    const cfg = r === true ? {} : r
    return {
        initialDelayMs: cfg.initialDelayMs ?? 500,
        maxDelayMs: cfg.maxDelayMs ?? 30_000,
        multiplier: cfg.multiplier ?? 2,
        maxAttempts: cfg.maxAttempts ?? Infinity,
        shouldRetry: cfg.shouldRetry ?? defaultShouldRetry,
        // On by default; startHeartbeat fills the defaults. Explicit `false` opts out.
        heartbeat: cfg.heartbeat === false ? undefined : (cfg.heartbeat ?? {}),
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
    const reconnectConfig = normalizeReconnect(config?.reconnect)
    const logMode = config?.logMode ?? GGWsLogMode.ALL

    let socket: GGSocket | undefined
    let savedSetup: GGWebSocketSetup<any, any> | undefined
    let reconnectAttempt = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let finallyClosed = false
    let finalCloseFired = false

    const onCloseCallbacks: Array<(reason: GGWebSocketCloseReason, error?: Error) => void> = []
    const onDisconnectCallbacks: Array<(reason: "manual" | "drop") => void> = []
    const onErrorCallbacks: Array<(error: Error) => void> = []

    // --------------------------------------------------------------------
    // URL resolution + query validation
    // --------------------------------------------------------------------

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
                originalError: err,
            })
        }
    }

    const validateQuery = (): any => {
        if (!queryValidator) return config?.query
        if (config?.query === undefined) return undefined
        const parsed = queryValidator.safeParse(config.query, true)
        if (parsed.success === false) {
            throw new VALIDATION_ERROR(parsed.issues.toJSON(), {displayMessage: "Invalid query parameters"})
        }
        return parsed.value
    }

    // --------------------------------------------------------------------
    // Outgoing — stable object; methods throw if called before/after connect
    // --------------------------------------------------------------------

    const outgoingImpl: Record<string, any> = {}
    for (const methodName of Object.keys(clientToServerContract.methods)) {
        const contractFn = clientToServerContract.methods[methodName] as GGContractMethod
        const hasResponse = contractFn.success !== undefined
        outgoingImpl[methodName] = async (data: any): Promise<any> => {
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

    // --------------------------------------------------------------------
    // Setup tools factory — fresh per connect attempt
    // --------------------------------------------------------------------

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

    // --------------------------------------------------------------------
    // Connection flow
    // --------------------------------------------------------------------

    /**
     * Open one socket. Runs setup, wires close/error handlers, starts heartbeat.
     * Throws on any failure — caller (initial connect or reconnect loop) decides
     * retry policy. Never leaves a socket dangling on error.
     */
    const openOnce = async (): Promise<void> => {
        const domain = await resolveDomain()
        const validatedQuery = validateQuery()
        const merged = [...schemaMiddlewares, ...(config?.middlewares ?? [])]
        const newSocket = await GGSocketPool.connect({
            domain,
            path: normalizedPath,
            query: validatedQuery,
            middlewares: merged,
        })

        // #1: If user called disconnect() while we were awaiting the handshake,
        //     close the freshly-opened socket immediately — don't leak it.
        if (finallyClosed) {
            newSocket.close()
            return
        }

        socket = newSocket

        // setupPhase guards the onClose listener: while setup is in flight, a drop
        // (whether from setup's own catch closing the socket, or an external close)
        // only fires onDisconnect. Reconnect scheduling / finalClose are the job of
        // the catch chain in this openOnce call or its caller (scheduleReconnect).
        // After setup completes, setupPhase is cleared and onClose becomes the
        // authoritative reconnect dispatcher.
        let setupPhase = true

        newSocket.onClose(() => {
            if (socket === newSocket) {
                socket = undefined
            }
            const reason: "manual" | "drop" = finallyClosed ? "manual" : "drop"
            if (logMode) {
                if (!finallyClosed) {
                    log.warn(schemaName, `ws drop ${schemaName}`, {kind: "drop", reason})
                } else if (logMode === GGWsLogMode.ALL) {
                    log.info(schemaName, `ws close ${schemaName}`, {kind: "close", reason})
                }
            }
            fireOnDisconnect(reason)
            if (finallyClosed) {
                fireFinalClose("manual")
                return
            }
            if (setupPhase) {
                // Catch chain owns retry decisions for setup-phase failures.
                return
            }
            if (!reconnectConfig) {
                fireFinalClose("drop")
                return
            }
            if (reconnectAttempt >= reconnectConfig.maxAttempts) {
                fireFinalClose("retries-exhausted")
                return
            }
            scheduleReconnect()
        })
        for (const cb of onErrorCallbacks) newSocket.onError(cb)

        // Heartbeat (if configured and adapter supports it — browsers no-op).
        if (reconnectConfig?.heartbeat) {
            newSocket.startHeartbeat(reconnectConfig.heartbeat)
        }

        // #2: Run setup with explicit cleanup on throw so we never leak a socket.
        if (savedSetup) {
            try {
                await savedSetup(buildSetupTools(newSocket))
            } catch (setupErr) {
                if (socket === newSocket) {
                    socket = undefined
                }
                try { newSocket.close() } catch (_) {}
                throw setupErr
            }
        }
        logMode === GGWsLogMode.ALL && log.info(schemaName, `ws ${reconnectAttempt > 0 ? "reconnected" : "open"} ${schemaName}`, {kind: reconnectAttempt > 0 ? "reconnect-success" : "open"})
        setupPhase = false
        reconnectAttempt = 0
    }

    /**
     * Schedule a retry per the reconnect config. Called from the onClose handler
     * (socket dropped) — never from initial connect().
     */
    const scheduleReconnect = () => {
        if (!reconnectConfig) return
        const attempt = reconnectAttempt++
        const delay = Math.min(
            reconnectConfig.initialDelayMs * Math.pow(reconnectConfig.multiplier, attempt),
            reconnectConfig.maxDelayMs,
        )
        logMode === GGWsLogMode.ALL && log.info(schemaName, `ws reconnect-attempt ${schemaName}`, {kind: "reconnect-attempt", attempt: attempt + 1, delayMs: delay})
        reconnectTimer = setTimeout(async () => {
            reconnectTimer = undefined
            if (finallyClosed) return
            try {
                await openOnce()
            } catch (err) {
                const error = err as Error
                for (const cb of onErrorCallbacks) {
                    try { cb(error) } catch (_) {}
                }
                // #4: terminal errors skip further retries.
                if (!reconnectConfig.shouldRetry(error)) {
                    fireFinalClose("unrecoverable", error)
                    return
                }
                if (reconnectAttempt < reconnectConfig.maxAttempts) {
                    scheduleReconnect()
                } else {
                    fireFinalClose("retries-exhausted", error)
                }
            }
        }, delay)
    }

    const fireOnDisconnect = (reason: "manual" | "drop") => {
        for (const cb of onDisconnectCallbacks) {
            try { cb(reason) } catch (_) {}
        }
    }

    const fireFinalClose = (reason: GGWebSocketCloseReason, error?: Error) => {
        if (finalCloseFired) return
        finalCloseFired = true
        if (logMode) {
            const message = `ws final-close ${schemaName} (${reason})`
            const data = {kind: "final-close", reason}
            if (reason === "retries-exhausted" || reason === "unrecoverable") {
                error ? log.error(schemaName, message, error, data) : log.error(schemaName, message, data)
            } else if (reason === "drop") {
                log.warn(schemaName, message, data)
            } else if (logMode === GGWsLogMode.ALL) {
                // reason === "manual" — informational, ALL only
                log.info(schemaName, message, data)
            }
        }
        for (const cb of onCloseCallbacks) {
            try { cb(reason, error) } catch (_) {}
        }
    }

    // --------------------------------------------------------------------
    // Public client surface
    // --------------------------------------------------------------------

    const client: GGWebSocketClient<any, any> = {
        outgoing,

        get isConnected(): boolean {
            return socket !== undefined
        },

        async connect(setup?: GGWebSocketSetup<any, any>): Promise<void> {
            if (finallyClosed) {
                throw new SERVER_ERROR({
                    displayMessage: "WebSocket client has been closed and cannot be reconnected. Create a new client.",
                })
            }
            if (socket) return
            savedSetup = setup
            await openOnce()
        },

        async disconnect(): Promise<void> {
            finallyClosed = true
            if (reconnectTimer) {
                clearTimeout(reconnectTimer)
                reconnectTimer = undefined
            }
            const s = socket
            socket = undefined
            if (s) {
                await s.teardown()
            } else {
                fireOnDisconnect("manual")
                fireFinalClose("manual")
            }
        },

        close(): void {
            finallyClosed = true
            if (reconnectTimer) {
                clearTimeout(reconnectTimer)
                reconnectTimer = undefined
            }
            const s = socket
            socket = undefined
            if (s) {
                s.close()
            } else {
                fireOnDisconnect("manual")
                fireFinalClose("manual")
            }
        },

        onClose(cb: (reason: GGWebSocketCloseReason, error?: Error) => void): any {
            onCloseCallbacks.push(cb)
            return this
        },

        onDisconnect(cb: (reason: "manual" | "drop") => void): any {
            onDisconnectCallbacks.push(cb)
            return this
        },

        onError(cb: (error: Error) => void): any {
            onErrorCallbacks.push(cb)
            if (socket) socket.onError(cb)
            return this
        },

        forceReconnect(): void {
            // No-op without reconnect — dropping the socket would just terminally close it.
            if (finallyClosed || !reconnectConfig || !socket) return
            // finallyClosed is false, so the onClose handler treats this as a "drop" and reconnects.
            socket.close()
        },
    }

    return client
}
