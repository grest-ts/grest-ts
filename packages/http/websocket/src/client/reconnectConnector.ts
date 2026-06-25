/**
 * Reconnect + liveness connector shared by the typed (`GGSocket`) and raw
 * (`GGRawSocket`) clients.
 *
 * Owns the whole connection lifecycle: open one socket, run a payload-specific
 * setup, wire close/error/heartbeat, and — on an unexpected drop — back off and
 * reopen, re-running setup so the client rebuilds its full state on every
 * reconnection. The payload layer supplies only two things: how to `open` a
 * fresh socket and how to `setup` handlers on it.
 */

import {FORBIDDEN, NOT_AUTHORIZED, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema"
import type {GGTransportMiddleware} from "@grest-ts/context"
import type {GGHeartbeatConfig} from "../socket/GGSocket"
import {GGWsLogMode} from "./GGWsLogMode"
import {log} from "./wsLog"

/**
 * The connection inputs for one attempt — either the static config fields or the return of
 * `beforeConnect`. Schema `.use()` wires apply on top regardless.
 */
export interface GGConnectParams<TQuery = undefined> {
    /** Server URL, e.g. "ws://host:port" ("" for same-origin in the browser). Omit to use @grest-ts/discovery (node). */
    url?: string
    /** Query params on connect, validated against the schema's `queryOnConnect`. */
    query?: TQuery
    /** Extra middlewares on top of the schema's, in order (e.g. a static auth token). */
    middlewares?: GGTransportMiddleware[]
}

/**
 * Connection params come from exactly ONE of two mutually-exclusive sources — the union makes
 * setting a static field alongside `beforeConnect` a compile error:
 *
 * - static `url` / `query` / `middlewares`, captured once;
 * - `beforeConnect`, resolved before EVERY connect attempt (first + every reconnect) — for
 *   short-lived / rotating credentials. Returns the complete `GGConnectParams` each time, so a
 *   minted token / signed URL is never stale.
 */
export type GGWsConnectSource<TQuery = undefined> =
    | (GGConnectParams<TQuery> & {beforeConnect?: never})
    | {
        beforeConnect: () => GGConnectParams<TQuery> | Promise<GGConnectParams<TQuery>>
        url?: never
        query?: never
        middlewares?: never
    }

/** Resolve one attempt's connect params: `beforeConnect` (sole source) if set, else the static config. */
export async function resolveConnectParams<TQuery>(
    source: GGWsConnectSource<TQuery> | undefined
): Promise<GGConnectParams<TQuery>> {
    if (source?.beforeConnect) return source.beforeConnect()
    return source ?? {}
}

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
     * Dead-connection detection via PING/PONG. On by default:
     * a missed heartbeat drops the socket and reconnects, so a half-open link self-heals
     * (works in the browser too). Pass `false` to disable, or an object to tune.
     */
    heartbeat?: GGHeartbeatConfig | false
}

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

/** The lifecycle surface a live socket must expose for the connector to drive it. */
export interface GGLiveSocket {
    onClose(handler: () => void): unknown
    onError(handler: (error: Error) => void): unknown
    startHeartbeat(config: GGHeartbeatConfig): unknown
    close(): void
    teardown(): Promise<void>
}

export interface GGConnectorHooks<TSocket extends GGLiveSocket> {
    schemaName: string
    logMode: GGWsLogMode
    reconnect: NormalizedReconnect | null
    /** Open one fresh socket (resolve URL, validate query, run the handshake). Throws on failure. */
    open(): Promise<TSocket>
    /** Wire handlers on a freshly opened socket. `isReconnect` is true for every open after the first. */
    setup(socket: TSocket, isReconnect: boolean): Promise<void> | void
    /**
     * Called instead of `socket.teardown()`/`socket.close()` when the client disconnects.
     * When provided, the connector fires disconnect/close callbacks itself rather than relying on
     * the socket's onClose event — use for pooled connections that must not close the shared socket.
     */
    disposeSocket?: (socket: TSocket) => void | Promise<void>
}

export interface GGConnector<TSocket extends GGLiveSocket> {
    connect(): Promise<void>
    disconnect(): Promise<void>
    close(): void
    isConnected(): boolean
    current(): TSocket | undefined
    onClose(cb: (reason: GGWebSocketCloseReason, error?: Error) => void): void
    onDisconnect(cb: (reason: "manual" | "drop") => void): void
    onError(cb: (error: Error) => void): void
    forceReconnect(): void
}

export interface NormalizedReconnect {
    initialDelayMs: number
    maxDelayMs: number
    multiplier: number
    maxAttempts: number
    shouldRetry: (error: Error) => boolean
    heartbeat?: GGHeartbeatConfig
}

/**
 * Default: don't retry on errors a retry can't fix. Auth failures (NOT_AUTHORIZED / FORBIDDEN)
 * and a query that fails validation (VALIDATION_ERROR — a malformed connect input, e.g. from
 * beforeConnect) are terminal; everything else (a dropped link, a transient mint failure) retries.
 */
const defaultShouldRetry = (err: Error): boolean => {
    if (err instanceof NOT_AUTHORIZED) return false
    if (err instanceof FORBIDDEN) return false
    if (err instanceof VALIDATION_ERROR) return false
    return true
}

/**
 * Reconnect is on by default; pass `false` to disable. Heartbeat rides along
 * (on by default) so a half-open link is detected and reconnected.
 */
export function normalizeReconnect(r: boolean | GGReconnectConfig | undefined): NormalizedReconnect | null {
    if (r === false) return null
    const cfg = r === undefined || r === true ? {} : r
    return {
        initialDelayMs: cfg.initialDelayMs ?? 500,
        maxDelayMs: cfg.maxDelayMs ?? 30_000,
        multiplier: cfg.multiplier ?? 2,
        maxAttempts: cfg.maxAttempts ?? Infinity,
        shouldRetry: cfg.shouldRetry ?? defaultShouldRetry,
        heartbeat: cfg.heartbeat === false ? undefined : (cfg.heartbeat ?? {}),
    }
}

export function createConnector<TSocket extends GGLiveSocket>(hooks: GGConnectorHooks<TSocket>): GGConnector<TSocket> {
    const {schemaName, logMode, reconnect} = hooks

    let socket: TSocket | undefined
    let reconnectAttempt = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let finallyClosed = false
    let finalCloseFired = false

    const onCloseCallbacks: Array<(reason: GGWebSocketCloseReason, error?: Error) => void> = []
    const onDisconnectCallbacks: Array<(reason: "manual" | "drop") => void> = []
    const onErrorCallbacks: Array<(error: Error) => void> = []

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

    /**
     * Open one socket. Runs setup, wires close/error handlers, starts heartbeat.
     * Throws on any failure — caller (initial connect or reconnect loop) decides
     * retry policy. Never leaves a socket dangling on error.
     */
    const openOnce = async (): Promise<void> => {
        const newSocket = await hooks.open()

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
            if (!reconnect) {
                fireFinalClose("drop")
                return
            }
            if (reconnectAttempt >= reconnect.maxAttempts) {
                fireFinalClose("retries-exhausted")
                return
            }
            scheduleReconnect()
        })
        for (const cb of onErrorCallbacks) newSocket.onError(cb)

        // Heartbeat (if configured and adapter supports it — browsers no-op).
        if (reconnect?.heartbeat) {
            newSocket.startHeartbeat(reconnect.heartbeat)
        }

        // #2: Run setup with explicit cleanup on throw so we never leak a socket.
        try {
            await hooks.setup(newSocket, reconnectAttempt > 0)
        } catch (setupErr) {
            if (socket === newSocket) {
                socket = undefined
            }
            try { newSocket.close() } catch (_) {}
            throw setupErr
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
        if (!reconnect) return
        const attempt = reconnectAttempt++
        const delay = Math.min(
            reconnect.initialDelayMs * Math.pow(reconnect.multiplier, attempt),
            reconnect.maxDelayMs,
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
                if (!reconnect.shouldRetry(error)) {
                    fireFinalClose("unrecoverable", error)
                    return
                }
                if (reconnectAttempt < reconnect.maxAttempts) {
                    scheduleReconnect()
                } else {
                    fireFinalClose("retries-exhausted", error)
                }
            }
        }, delay)
    }

    return {
        isConnected: () => socket !== undefined,
        current: () => socket,

        async connect(): Promise<void> {
            if (finallyClosed) {
                throw new SERVER_ERROR({
                    displayMessage: "WebSocket client has been closed and cannot be reconnected. Create a new client.",
                })
            }
            if (socket) return
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
                if (hooks.disposeSocket) {
                    await hooks.disposeSocket(s)
                    fireOnDisconnect("manual")
                    fireFinalClose("manual")
                } else {
                    await s.teardown()
                    // onClose fires → fireOnDisconnect + fireFinalClose
                }
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
                if (hooks.disposeSocket) {
                    const result = hooks.disposeSocket(s)
                    if (result instanceof Promise) result.catch(() => {})
                    fireOnDisconnect("manual")
                    fireFinalClose("manual")
                } else {
                    s.close()
                    // onClose fires → fireOnDisconnect + fireFinalClose
                }
            } else {
                fireOnDisconnect("manual")
                fireFinalClose("manual")
            }
        },

        onClose(cb): void { onCloseCallbacks.push(cb) },
        onDisconnect(cb): void { onDisconnectCallbacks.push(cb) },
        onError(cb): void {
            onErrorCallbacks.push(cb)
            if (socket) socket.onError(cb)
        },

        forceReconnect(): void {
            // No-op without reconnect — dropping the socket would just terminally close it.
            if (finallyClosed || !reconnect || !socket) return
            // finallyClosed is false, so the onClose handler treats this as a "drop" and reconnects.
            socket.close()
        },
    }
}
