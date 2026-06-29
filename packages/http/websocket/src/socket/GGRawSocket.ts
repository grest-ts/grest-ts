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

// Framework-reserved keepalive frames. A browser can't send a protocol WS ping (the native API
// hides ping/pong), so a raw stream probes a half-open link with an in-band frame instead. Unlike
// the typed GGSocket — which has a control-frame channel — a raw payload is opaque, so these ride
// the wire as ordinary text frames. NUL-wrapping makes collision with real app text (JSON control,
// log lines) effectively impossible, and they're filtered out of BOTH directions below so the
// application never sees them — the raw equivalent of GGSocket's transparent PING/PONG.
const NUL = String.fromCharCode(0);
const RAW_PING = NUL + "gg-raw-ping" + NUL;
const RAW_PONG = NUL + "gg-raw-pong" + NUL;
// Both sentinels are equal-length single-byte strings, so one length gate filters candidates
// without decoding ordinary (often large) text frames.
const SENTINEL_LEN = RAW_PING.length;

function rawKeepaliveKind(data: Uint8Array, isBinary: boolean): "ping" | "pong" | undefined {
    if (isBinary || data.length !== SENTINEL_LEN) return undefined;
    const text = new TextDecoder().decode(data);
    if (text === RAW_PING) return "ping";
    if (text === RAW_PONG) return "pong";
    return undefined;
}

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
     * App-level keepalive (the reserved sentinel ping/pong). Default on. Set false for a
     * `customClient` socket: the peer is a foreign client that doesn't speak the sentinel, and a
     * customClient stream is meant to be an untouched byte passthrough — so the framework neither
     * injects nor inspects for keepalive frames here. Protocol-level (Node `ping`) liveness is
     * unaffected and still reaps dead peers.
     */
    appKeepalive?: boolean;
}

export class GGRawSocket {

    private readonly adapter: SocketAdapter;
    private readonly apiName: string;
    private readonly socketPath: string;
    private readonly connectionContext: GGContext;
    private readonly scope?: {ensureEntered(): void};
    private readonly metrics?: GGSocketMetrics;
    private readonly log: GGSocketLogger;
    private readonly appKeepalive: boolean;

    private isActive = true;
    private isClosed = false;
    private lastActivity = Date.now();

    private readonly onCloseCallbacks: Array<() => void> = [];
    private readonly messageHandlers: Array<(data: Buffer, isBinary: boolean) => void> = [];
    // Frames received before the first onMessage handler exists — held, then flushed on
    // registration, so a peer's first frame isn't lost in that window.
    private readonly pendingInbound: Array<[Buffer, boolean]> = [];

    constructor(adapter: SocketAdapter, config: GGRawSocketConfig) {
        this.adapter = adapter;
        this.apiName = config.apiName;
        this.socketPath = config.socketPath;
        this.connectionContext = config.connectionContext;
        this.scope = config.scope;
        this.metrics = config.metrics;
        this.log = config.log ?? consoleLogger;
        this.appKeepalive = config.appKeepalive ?? true;

        // One inbound listener fans out to all app handlers and, unless this is a foreign
        // (customClient) passthrough, transparently absorbs the framework's keepalive frames
        // (auto-pong a PING, swallow a PONG) so the application never sees them — the raw
        // counterpart of GGSocket's control-frame PING/PONG.
        this.adapter.onRawMessage!((d, isBinary) => {
            this.lastActivity = Date.now();
            if (this.appKeepalive) {
                const kind = rawKeepaliveKind(d, isBinary);
                if (kind === "ping") { this.send(RAW_PONG); return; }
                if (kind === "pong") return;
            }
            this.scope?.ensureEntered();
            this.connectionContext.run(() => {
                if (this.messageHandlers.length === 0) {
                    this.pendingInbound.push([d as Buffer, isBinary]);
                    return;
                }
                for (const h of this.messageHandlers) h(d as Buffer, isBinary);
            });
        });

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
     * Register a handler for inbound frames, delivered as a Buffer plus `isBinary` (the WebSocket
     * frame type — a text-vs-binary protocol like a terminal relies on it). Handlers run inside the
     * connection context so they can read the authenticated principal; multiple may be registered.
     * Framework keepalive frames are absorbed before dispatch, so handlers never see them.
     * The first registration flushes `pendingInbound` (frames that arrived before it).
     */
    public onMessage(handler: (data: Buffer, isBinary: boolean) => void): this {
        this.messageHandlers.push(handler);
        if (this.pendingInbound.length > 0) {
            const buffered = this.pendingInbound.splice(0, this.pendingInbound.length);
            this.scope?.ensureEntered();
            this.connectionContext.run(() => {
                for (const [data, isBinary] of buffered) {
                    for (const h of this.messageHandlers) h(data, isBinary);
                }
            });
        }
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
            // A raw stream has no protocol ping in the browser; probe with the framework's reserved
            // keepalive frame (the peer auto-pongs in the dispatch above). On Node, protocol ping is
            // preferred and this is ignored; a customClient passthrough opts out entirely.
            appPing: this.appKeepalive ? () => this.send(RAW_PING) : undefined,
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
