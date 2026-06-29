/**
 * Raw byte-stream socket: the payload-free sibling of GGSocket.
 *
 * A schema socket (GGSocket) layers a typed request/response message protocol on top
 * of the connection. A raw socket skips that entirely — once the connection's handshake
 * and auth have run, the application owns the wire and exchanges opaque frames (PTY,
 * log tail, binary stream). The connection pipeline up to this point (path dispatch,
 * query validation, handshake auth via middlewares/wires, discovery, metrics) is
 * identical to a schema socket; only the post-handshake payload differs.
 */

import type {GGContext} from "@grest-ts/context";
import {GGSocketLogger, GGSocketMetrics, type GGHeartbeatConfig} from "./GGSocket";
import {SocketAdapter} from "./SocketAdapter";
import {startSocketHeartbeat} from "../liveness/socketHeartbeat";

const consoleLogger: GGSocketLogger = {
    debug(_source, message, ...args) { console.debug("[GGRawSocket]", message, ...args) },
    warn(_source, message, ...args) { console.warn("[GGRawSocket]", message, ...args) },
    error(_source, ...args) { console.error("[GGRawSocket]", ...args) },
};

export interface GGRawSocketConfig {
    apiName: string;
    socketPath: string;
    /** Connection context (where the auth wire minted the principal); re-entered for callbacks. */
    connectionContext: GGContext;
    /** Locator scope, re-entered before callbacks fire (WS events lose AsyncLocalStorage). Server-only. */
    scope?: {ensureEntered(): void};
    metrics?: GGSocketMetrics;
    log?: GGSocketLogger;
    /**
     * App-level keepalive frame, sent on the heartbeat interval to probe the link. A raw stream
     * has no framework ping, and a browser can't send a protocol WS ping — so without this the
     * watchdog self-disables and a half-open link is never detected client-side. Any inbound frame
     * (ideally a pong the server's handler sends back) counts as proof of life. Set on the client
     * (browser); omit on the server, where the Node adapter's protocol ping covers liveness.
     */
    heartbeatPing?: Uint8Array | string;
}

export class GGRawSocket {

    private readonly adapter: SocketAdapter;
    private readonly apiName: string;
    private readonly socketPath: string;
    private readonly connectionContext: GGContext;
    private readonly scope?: {ensureEntered(): void};
    private readonly metrics?: GGSocketMetrics;
    private readonly log: GGSocketLogger;
    private readonly heartbeatPing?: Uint8Array | string;

    private isActive = true;
    private isClosed = false;
    private lastActivity = Date.now();

    private readonly onCloseCallbacks: Array<() => void> = [];

    constructor(adapter: SocketAdapter, config: GGRawSocketConfig) {
        this.adapter = adapter;
        this.apiName = config.apiName;
        this.socketPath = config.socketPath;
        this.connectionContext = config.connectionContext;
        this.scope = config.scope;
        this.metrics = config.metrics;
        this.log = config.log ?? consoleLogger;
        this.heartbeatPing = config.heartbeatPing;

        this.adapter.onClose(() => {
            this.scope?.ensureEntered();
            this.connectionContext.run(() => {
                this.isActive = false;
                if (this.isClosed) return;
                this.isClosed = true;
                for (const cb of this.onCloseCallbacks) {
                    try { cb(); } catch (e) { this.log.error(this, e); }
                }
            });
        });
    }

    /**
     * Deliver every inbound frame as a Buffer plus `isBinary` (the WebSocket frame type — a
     * text-vs-binary protocol like a terminal relies on it). Runs inside the connection context
     * so the handler can read the authenticated principal. Any inbound frame is also proof of
     * life for the heartbeat watchdog.
     */
    public onMessage(handler: (data: Buffer, isBinary: boolean) => void): this {
        this.adapter.onRawMessage!((d, isBinary) => {
            this.lastActivity = Date.now();
            this.scope?.ensureEntered();
            this.connectionContext.run(() => handler(d as Buffer, isBinary));
        });
        return this;
    }

    public send(data: Uint8Array | string): void {
        if (!this.isActive) return;
        this.adapter.sendRaw!(data);
    }

    public onClose(handler: () => void): this {
        this.onCloseCallbacks.push(handler);
        return this;
    }

    public onError(handler: (error: Error) => void): this {
        this.adapter.onError(handler);
        return this;
    }

    public startHeartbeat(config: GGHeartbeatConfig = {}): () => void {
        return startSocketHeartbeat(this.adapter, {
            config,
            isActive: () => this.isActive,
            stampActivity: () => { this.lastActivity = Date.now(); },
            idleMs: () => Date.now() - this.lastActivity,
            apiName: this.apiName,
            socketPath: this.socketPath,
            metrics: this.metrics,
            log: this.log,
            logSource: this,
            close: () => this.close(),
            registerCleanup: (fn) => this.onCloseCallbacks.push(fn),
            appPing: this.heartbeatPing !== undefined ? () => this.send(this.heartbeatPing!) : undefined,
        });
    }

    public close(): void {
        if (!this.isActive) return;
        this.isActive = false;
        try {
            this.adapter.close();
        } catch (_) { /* ignore */ }
    }

    /** Server-side teardown hook (matches GGSocket.teardown so both share activeSockets). */
    public async teardown(): Promise<void> {
        this.close();
    }
}
