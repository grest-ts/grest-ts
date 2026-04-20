/**
 * Unified WebSocket implementation for both client and server
 * Handles messaging only - context is set from effects at connection time
 */

import {Message, MessageType, RegularMessage, RequestMessage} from "./SocketMessage";
import {SocketAdapter} from "./SocketAdapter";
import {PendingRequestsMap} from "./utils/PendingRequestsMap";
import {GG_WS_MESSAGE} from "../server/GG_WS_MESSAGE";
import {ERROR, GGPromise, ROUTE_NOT_FOUND, SERVER_ERROR} from "@grest-ts/schema";
import {GGContext} from "@grest-ts/context";
import {GG_TRACE} from "@grest-ts/trace";

/**
 * Handler configuration for socket messages.
 * Handler is expected to be already wrapped with contract validation.
 */
export interface SocketHandlerConfig {
    path: string;
    handler: (data?: any) => GGPromise<any, any> | Promise<any> | void;
}

export interface GGSocketLogger {
    debug(source: any, message: string, ...args: any[]): void;
    warn(source: any, message: string, ...args: any[]): void;
    error(source: any, ...args: any[]): void;
}

const consoleLogger: GGSocketLogger = {
    debug(_source, message, ...args) { console.debug("[GGSocket]", message, ...args) },
    warn(_source, message, ...args) { console.warn("[GGSocket]", message, ...args) },
    error(_source, ...args) { console.error("[GGSocket]", ...args) },
}

export interface GGSocketMetrics {
    recordIn(labels: {api: string, path: string, method: string}, result: string, startTime?: number): void;
    recordOut(labels: {api: string, path: string, method: string}, result: string, startTime?: number): void;
}

export interface GGSocketConfig {
    apiName?: string;
    socketPath?: string;
    /** Optional wrapper that runs handlers in the context established at connection time */
    connectionContext?: GGContext;
    /** Optional locator scope for re-entering async context in event callbacks (server-only) */
    scope?: {ensureEntered(): void};
    /** Optional metrics recorder (server-only) */
    metrics?: GGSocketMetrics;
    /** Optional logger (defaults to console) */
    log?: GGSocketLogger;
}

interface MetricLabels {
    api: string;
    path: string;
    method: string;
}

export class GGSocket {

    private readonly socket: SocketAdapter;
    private readonly handlers: Map<string, SocketHandlerConfig> = new Map();
    private readonly pendingRequests = new PendingRequestsMap();

    private unknownMessageHandler?: (path: string, data: any) => void;

    private isActive = true;
    private isCleanedUp = false;
    private tearingDownPromise: Promise<void>;

    private readonly onTearDownCallbacks: Array<() => Promise<void>> = [];
    private readonly onCloseCallbacks: Array<() => void> = [];
    private readonly onErrorCallbacks: Array<(error: Error) => void> = [];

    // Metrics labels (optional - set when created by server)
    private readonly apiName: string;
    private readonly socketPath: string;
    private readonly connectionContext: GGContext;
    private readonly metrics?: GGSocketMetrics;
    private readonly log: GGSocketLogger;

    constructor(socket: SocketAdapter, config?: GGSocketConfig) {
        this.socket = socket;
        this.apiName = config?.apiName ?? 'unknown';
        this.socketPath = config?.socketPath ?? 'unknown';
        // Default to passthrough if no context wrapper provided
        this.connectionContext = config?.connectionContext ?? new GGContext('__unnamed_GGSocket_context');
        this.metrics = config?.metrics;
        this.log = config?.log ?? consoleLogger;

        // Scope is provided by server for re-entering async context in event callbacks
        const scope = config?.scope;

        this.socket.onMessage(async (data: string) => {
            scope?.ensureEntered();
            const context = new GGContext("ws-message", this.connectionContext);
            await context.run(async () => {
                GG_TRACE.init();

                const msg = Message.parse(data);
                if (!msg) {
                    return;
                }

                if (this.isActive) {
                    if (msg.type === MessageType.MSG || msg.type === MessageType.REQ) {
                        GG_WS_MESSAGE.set({path: msg.path});
                        await this.handleIncomingMessage(msg);
                    } else if (msg.type === MessageType.RES) {
                        this.pendingRequests.resolve(msg.id, msg.data);
                    }
                }
            })
        });

        this.socket.onClose(() => {
            scope?.ensureEntered();
            this.connectionContext.run(() => {
                this.isActive = false;
                if (!this.isCleanedUp) {
                    this.isCleanedUp = true;
                    this.pendingRequests.rejectAll(new SERVER_ERROR({displayMessage: "Socket connection closed!"}));
                    this.onCloseCallbacks.forEach((onClose) => {
                        try {
                            onClose?.();
                        } catch (e) {
                            this.onErrorCallbacks.forEach(cb => cb(e));
                        }
                    });
                }
            });
        });

        this.socket.onError((error: Error) => {
            scope?.ensureEntered();
            this.connectionContext.run(() => {
                this.onErrorCallbacks.forEach(cb => cb(error));
            });
        });
    }

    // --------------------------------------------------------------------------------------
    // Incoming message handling
    // --------------------------------------------------------------------------------------

    private async handleIncomingMessage(msg: RegularMessage | RequestMessage): Promise<void> {
        const startTime = performance.now();
        const labels: MetricLabels = {api: this.apiName, path: this.socketPath, method: msg.path};
        const expectsResponse = msg.type === MessageType.REQ;

        try {
            const handlerDef = this.handlers.get(msg.path);

            if (!handlerDef) {
                this.handleMissingRoute(msg, labels, startTime, expectsResponse);
                return;
            }

            // Handler returns GGPromise - use asResult() to get OK | ERROR
            const ggPromise = handlerDef.handler(msg.data);
            const res = await (ggPromise as any).asResult();

            if (expectsResponse) {
                this.sendResponse(msg as RequestMessage, res, labels, startTime);
            } else {
                this.handleFireAndForgetResult(res, labels, startTime);
            }
        } catch (error) {
            this.log.error(this, error);
            this.onErrorCallbacks.forEach(cb => cb(error as Error));
        }
    }

    private handleMissingRoute(
        msg: RegularMessage | RequestMessage,
        labels: MetricLabels,
        startTime: number,
        expectsResponse: boolean
    ): void {
        if (expectsResponse) {
            const error = new ROUTE_NOT_FOUND({displayMessage: "Route not found: " + msg.path});
            this.log.error(this, error);
            this.sendResponse(msg as RequestMessage, error, labels, startTime);
        } else {
            if (this.unknownMessageHandler) {
                this.unknownMessageHandler(msg.path, msg.data);
            } else {
                this.log.warn(this, 'Unknown method ' + msg.path);
            }
            this.recordInMetric(labels, 'ROUTE_NOT_FOUND', startTime);
        }
    }

    private sendResponse(
        msg: RequestMessage,
        res: any,
        labels: MetricLabels,
        startTime: number
    ): void {
        const isError = res instanceof ERROR || (res && res.success === false);
        const resultType = isError ? res.type : 'OK';
        // res is OK_JSON or ERROR - send as-is (it's already in the right format)
        const data = isError && res instanceof ERROR ? res.toJSON() : res;

        this.recordInMetric(labels, resultType, startTime);

        try {
            this.socket.send(Message.create(MessageType.RES, msg.path, msg.id, data));
        } catch (error) {
            this.log.error(this, "ERROR_SENDING_RESPONSE", ERROR.fromUnknown(error));
        }
    }

    private handleFireAndForgetResult(res: any, labels: MetricLabels, startTime: number): void {
        const isError = res instanceof ERROR || (res && res.success === false);
        if (isError) {
            this.recordInMetric(labels, res.type, startTime);
            this.onErrorCallbacks.forEach(cb => cb(res));
        } else {
            this.recordInMetric(labels, 'OK', startTime);
        }
    }

    // --------------------------------------------------------------------------------------
    // Outgoing message handling
    // --------------------------------------------------------------------------------------

    /**
     * Send a message over the socket (raw transport).
     * Data is expected to be already validated by the contract layer.
     *
     * @param path - The message path/route
     * @param body - The message data (already validated)
     * @param expectsResponse - Whether to wait for a response
     * @param timeoutMs - Timeout for req/res in ms. Ignored for fire-and-forget. Defaults to 30_000.
     */
    public async send(
        path: string,
        body: any,
        expectsResponse: boolean,
        timeoutMs: number = 30000
    ): Promise<any> {
        const labels: MetricLabels = {api: this.apiName, path: this.socketPath, method: path};
        const startTime = performance.now();

        if (!this.isActive) {
            this.recordOutMetric(labels, 'CONNECTION_CLOSED');
            throw new Error('Cannot send: WebSocket is not connected');
        }

        if (expectsResponse) {
            return this.pendingRequests.create(path, timeoutMs, async (id, waitForResponse) => {
                this.socket.send(Message.create(MessageType.REQ, path, id, body));
                const result = await waitForResponse;
                const resultType = result?.success === true ? 'OK' : (result?.type ?? 'SERVER_ERROR');
                this.recordOutMetric(labels, resultType, startTime);
                return result;
            });
        } else {
            this.socket.send(Message.create(MessageType.MSG, path, "", body));
            this.recordOutMetric(labels, 'OK');
        }
    }

    // --------------------------------------------------------------------------------------
    // Metrics helpers
    // --------------------------------------------------------------------------------------

    private recordInMetric(labels: MetricLabels, result: string, startTime?: number): void {
        this.metrics?.recordIn(labels, result, startTime);
    }

    private recordOutMetric(labels: MetricLabels, result: string, startTime?: number): void {
        this.metrics?.recordOut(labels, result, startTime);
    }

    // --------------------------------------------------------------------------------------
    // Handler registration
    // --------------------------------------------------------------------------------------

    public registerHandler(config: SocketHandlerConfig): void {
        this.handlers.set(config.path, config);
    }

    public unregisterHandler(path: string): void {
        this.handlers.delete(path);
    }

    public setUnknownMessageHandler(handler: (path: string, data: any) => void): void {
        this.unknownMessageHandler = handler;
    }

    // --------------------------------------------------------------------------------------
    // Lifecycle callbacks
    // --------------------------------------------------------------------------------------

    public onError(onError: (error: Error) => void): this {
        this.onErrorCallbacks.push(onError);
        return this;
    }

    public onTearDown(onClosing: () => Promise<void>): this {
        this.onTearDownCallbacks.push(onClosing);
        return this;
    }

    public onClose(onClose: () => void): this {
        this.onCloseCallbacks.push(onClose);
        return this;
    }

    // --------------------------------------------------------------------------------------
    // Heartbeat (PING/PONG) — dead-connection detection
    // --------------------------------------------------------------------------------------

    /**
     * Start a heartbeat loop that sends protocol-level PINGs and closes the socket
     * if no PONG comes back within `intervalMs + timeoutMs`. Returns a stop function.
     *
     * No-op (returns an empty stop fn) if the underlying adapter does not support
     * ping/pong — e.g. the browser WebSocket API cannot initiate pings.
     */
    public startHeartbeat(config: {intervalMs: number; timeoutMs: number}): () => void {
        // Adapter doesn't support ping/pong (e.g. browser WebSocket) — no-op.
        if (!this.socket.ping || !this.socket.onPong) {
            return () => {};
        }
        // Socket is already closed — starting heartbeat would leak intervals
        // because the onCloseCallbacks push below won't fire (isCleanedUp guard).
        if (!this.isActive) {
            return () => {};
        }
        let lastActivity = Date.now();
        const onPong = () => { lastActivity = Date.now(); };
        this.socket.onPong(onPong);

        const sender = setInterval(() => {
            if (!this.isActive) return;
            try {
                this.socket.ping!();
            } catch (_) { /* adapter may throw if socket already closing */ }
        }, config.intervalMs);

        const watchdog = setInterval(() => {
            if (!this.isActive) return;
            if (Date.now() - lastActivity > config.intervalMs + config.timeoutMs) {
                this.log.warn(this, 'Heartbeat timeout — no PONG received; closing socket');
                clearInterval(sender);
                clearInterval(watchdog);
                this.close();
            }
        }, config.timeoutMs);

        // Auto-cleanup on close
        const cleanup = () => {
            clearInterval(sender);
            clearInterval(watchdog);
        };
        this.onCloseCallbacks.push(cleanup);

        return cleanup;
    }

    // --------------------------------------------------------------------------------------
    // Teardown
    // --------------------------------------------------------------------------------------

    /**
     * Get the number of pending outgoing requests
     */
    public get pendingRequestCount(): number {
        return this.pendingRequests.size;
    }

    /**
     * Starts the socket closing process gracefully.
     * 1. First waits for pending outgoing requests to complete (up to pendingRequestsTimeoutMs)
     * 2. Then runs user teardown handlers
     * 3. Finally closes the socket
     *
     * @param pendingRequestsTimeoutMs - Max time to wait for pending requests (default: 5000ms)
     * @param callbacksTimeoutMs - Max time to wait for teardown callbacks (default: 5000ms)
     */
    public async teardown(pendingRequestsTimeoutMs: number = 5000, callbacksTimeoutMs: number = 5000): Promise<void> {
        if (this.tearingDownPromise) {
            this.log.warn(this, 'Already tearing down!');
            return this.tearingDownPromise;
        }
        this.log.debug(this, 'Teardown started');

        this.tearingDownPromise = (async () => {
            // Step 1: Wait for pending outgoing requests to complete
            if (this.pendingRequests.hasPending()) {
                this.log.debug(this, `Waiting for ${this.pendingRequests.size} pending request(s) to complete...`);
                await this.pendingRequests.waitForPending(pendingRequestsTimeoutMs);
                if (this.pendingRequests.hasPending()) {
                    this.log.warn(this, `Timeout waiting for pending requests, ${this.pendingRequests.size} request(s) still pending`);
                }
            }

            // Step 2: Run user teardown callbacks with timeout
            await this.runTeardownCallbacks(callbacksTimeoutMs);

            // Step 3: Close the socket
            this.close();
        })();

        return this.tearingDownPromise;
    }

    /**
     * Run all teardown callbacks concurrently with a timeout.
     */
    private runTeardownCallbacks(timeoutMs: number): Promise<void> {
        if (this.onTearDownCallbacks.length === 0) {
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            let remaining = this.onTearDownCallbacks.length;
            let resolved = false;

            const finish = () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    resolve();
                }
            };

            const timeout = setTimeout(() => {
                this.log.warn(this, `Teardown timeout - ${remaining} callback(s) still pending after ${timeoutMs}ms`);
                finish();
            }, timeoutMs);

            for (const callback of this.onTearDownCallbacks) {
                callback()
                    .catch((err) => this.log.error(this, 'Error in teardown callback', err))
                    .finally(() => {
                        remaining--;
                        if (remaining === 0) finish();
                    });
            }
        });
    }

    /**
     * Immediately closes the socket.
     */
    public close(): void {
        if (this.isActive) {
            this.isActive = false;
            try {
                this.socket.close();
            } catch (e) {
                // Ignore close errors
            }
        }
    }

}
