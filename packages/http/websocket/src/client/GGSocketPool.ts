import {GGSocket} from '../socket/GGSocket';
import {SocketAdapter} from "../socket/SocketAdapter";
import {GG_WS_CONNECTION} from "../server/GG_WS_CONNECTION";
import {Message, MessageType} from "../socket/SocketMessage";
import {GGContractExecutor, GGValidator, SERVER_ERROR} from "@grest-ts/schema";
import {withTimeout} from "@grest-ts/common";
import {GGContext, GGContextKey, GGContextStore, type GGOutbound, type GGTransportMiddleware} from "@grest-ts/context";
import {GGContextKeySynchronizer} from "@grest-ts/http";
import {GG_TRACE} from "@grest-ts/trace";
import {getDefaultAdapter} from "../adapter/getDefaultAdapter";

export interface GGSocketPoolConfig<Query> {
    domain: string,
    path: string,
    query?: Query
    queryValidator?: GGValidator<Query>
    middlewares?: readonly GGTransportMiddleware[]
}

/**
 * Connection pool for WebSocket connections
 * Reuses existing connections when the same URL + headers combination is requested
 */
export class GGSocketPool {
    private static sockets = new Map<string, GGSocket>();
    private static pendingSockets = new Map<string, Promise<GGSocket>>();
    private static adapter: any = null;
    private static adapterPromise: Promise<any> | null = null;

    /**
     * Get the current number of active connections in the pool
     */
    public static get size(): number {
        return this.sockets.size;
    }

    /**
     * Get the current number of pending connections being established
     */
    public static get pendingSize(): number {
        return this.pendingSockets.size;
    }

    /**
     * Close all pooled connections gracefully.
     * Waits for pending connections to establish before closing them.
     * @param graceful - If true, calls teardown() on each socket allowing pending requests to complete.
     *                   If false, calls close() for immediate termination.
     */
    public static async closeAll(graceful: boolean = true): Promise<void> {
        // Wait for any pending connections to establish first
        const pendingPromises = Array.from(this.pendingSockets.values());
        if (pendingPromises.length > 0) {
            await Promise.allSettled(pendingPromises);
        }

        // Close all active connections
        const sockets = Array.from(this.sockets.values());
        if (graceful) {
            await Promise.allSettled(sockets.map(socket => socket.teardown()));
        } else {
            sockets.forEach(socket => socket.close());
        }

        // Clear the maps (onClose handlers should have already removed them,
        // but clear explicitly to handle any edge cases)
        this.sockets.clear();
        this.pendingSockets.clear();
    }

    /**
     * Clear all maps without closing connections.
     * WARNING: This will cause memory leaks if connections are still active.
     * Only use for testing purposes.
     */
    public static __clearForTesting(): void {
        this.sockets.clear();
        this.pendingSockets.clear();
        this.adapter = null;
        this.adapterPromise = null;
    }

    /**
     * Remove a specific connection from the pool by its key.
     * Does NOT close the socket - just removes it from the pool.
     * @returns true if the connection was found and removed, false otherwise
     */
    public static removeFromPool(key: string): boolean {
        return this.sockets.delete(key);
    }

    /**
     * Get all connection keys currently in the pool (for debugging/monitoring)
     */
    public static getConnectionKeys(): string[] {
        return Array.from(this.sockets.keys());
    }

    /**
     * Ensure adapter is loaded (lazy initialization)
     */
    private static async ensureAdapter(): Promise<any> {
        if (this.adapter) {
            return this.adapter;
        }

        if (!this.adapterPromise) {
            this.adapterPromise = getDefaultAdapter();
        }

        // Always await the promise to handle race conditions
        this.adapter = await this.adapterPromise;
        return this.adapter;
    }

    public static setAdapter(adapter: new(args: any, options?: any) => SocketAdapter) {
        this.adapter = adapter;
        this.adapterPromise = Promise.resolve(adapter);
    }

    /**
     * Build handshake headers from middlewares' update()
     */
    private static buildHeaders(config: GGSocketPoolConfig<any>): Record<string, string> {
        if (!config.middlewares) {
            return {};
        }

        const outbound: GGOutbound = {headers: {}};
        for (const middleware of config.middlewares) {
            middleware.update?.(outbound);
        }
        return outbound.headers;
    }

    /**
     * Await GGContextKeySynchronizer.waitFor for each middleware that carries a key.
     * Must be called before reading middleware keys to ensure fresh values.
     */
    private static async gateMiddlewares(middlewares: readonly GGTransportMiddleware[] | undefined): Promise<void> {
        if (!middlewares) return;
        for (const mw of middlewares) {
            if (mw instanceof GGContextKey) {
                await GGContextKeySynchronizer.waitFor(mw);
            }
        }
    }

    static async getOrConnect<Query>(
        config: GGSocketPoolConfig<Query>
    ): Promise<GGSocket> {
        await this.gateMiddlewares(config.middlewares);
        const headers = this.buildHeaders(config);
        const fullUrl = this.buildUrl(config);

        // Create connection key based on URL + headers
        const headerKey = Object.entries(headers).sort().map(([k, v]) => `${k}=${v}`).join('&');
        const key = fullUrl + "::" + headerKey;

        if (this.sockets.has(key)) {
            return this.sockets.get(key);
        }
        if (this.pendingSockets.has(key)) {
            return this.pendingSockets.get(key);
        }

        const connectionPromise = this.openSocket(fullUrl, config, config.domain);
        this.pendingSockets.set(key, connectionPromise);

        try {
            const socket = await connectionPromise;
            this.sockets.set(key, socket);
            this.pendingSockets.delete(key);
            socket.onClose(() => {
                this.sockets.delete(key);
            });
            return socket;
        } catch (error) {
            this.pendingSockets.delete(key);
            throw error;
        }
    }

    /**
     * Establish a fresh, un-pooled WebSocket connection.
     *
     * Unlike `getOrConnect`, this never reuses or caches connections — every
     * call produces a dedicated socket with its own close lifecycle. Use this
     * when you want each logical client to own its connection (the common
     * case for `createClient()` users).
     */
    static async connect<Query>(
        config: GGSocketPoolConfig<Query>
    ): Promise<GGSocket> {
        return this.openSocket(this.buildUrl(config), config, config.domain);
    }

    /**
     * Reconstruct the typed error the server threw during handshake.
     *
     * The server sends `error.toJSON()` which has `{success:false, type, data?, context?}`.
     * System errors (NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, etc.) are reconstructed
     * as real instances so callers can `.toBeError(NOT_AUTHORIZED)`. Anything we can't
     * identify (non-ERROR throw, custom error class the client doesn't know) falls back
     * to SERVER_ERROR carrying the original payload for inspection.
     */
    private static handshakeErrorFrom(payload: any): Error {
        if (payload && typeof payload === 'object' && typeof payload.type === 'string') {
            return GGContractExecutor.createErrorObj(payload) as unknown as Error;
        }
        return new SERVER_ERROR({
            displayMessage: 'WebSocket handshake failed',
            originalError: payload,
        });
    }

    private static buildUrl(config: GGSocketPoolConfig<any>): string {
        let fullUrl = config.domain + config.path;
        if (config.query) {
            const queryEntries: [string, string][] = Object.entries(config.query).map(([key, value]) => [key, String(value)]);
            fullUrl += '?' + new URLSearchParams(queryEntries).toString();
        }
        return fullUrl;
    }

    private static async openSocket(fullUrl: string, config: GGSocketPoolConfig<any>, domain: string): Promise<GGSocket> {
        const adapterClass = await this.ensureAdapter();
        return new Promise<GGSocket>((resolve, reject) => {
            const adapter = new adapterClass(fullUrl);
            adapter.onOpen(async () => {
                try {
                    // Inherit the connecting context as parent so context
                    // keys (auth tokens, user/org session, trace ids…) set
                    // by the caller propagate into the WS connection's
                    // operations and into events delivered through it.
                    // Without a parent, downstream HTTP calls fired from
                    // a WS event handler can't see the user's session
                    // tokens — they'd be looking up GG_USER_TOKEN /
                    // GG_ORG_TOKEN in an empty isolated context.
                    const context = new GGContext("ws-client-connection", GGContextStore.tryGetContext());
                    await context.run(async () => {
                        GG_TRACE.init();
                        GG_WS_CONNECTION.set({
                            port: undefined,
                            path: domain
                        });
                        await this.gateMiddlewares(config.middlewares);
                        const headers = this.buildHeaders(config);
                        adapter.send(Message.create(MessageType.HANDSHAKE, "", "", headers));
                        await withTimeout(
                            new Promise<void>((handshakeResolve, handshakeReject) => {
                                const onMessage = (data: string) => {
                                    const msg = Message.parse(data);
                                    if (!msg) return;

                                    if (msg.type === MessageType.HANDSHAKE_OK) {
                                        adapter.offMessage(onMessage);
                                        handshakeResolve();
                                    } else if (msg.type === MessageType.HANDSHAKE_ERR) {
                                        adapter.offMessage(onMessage);
                                        handshakeReject(this.handshakeErrorFrom(msg.data));
                                    }
                                };
                                adapter.onMessage(onMessage);
                            }),
                            5000,
                            'Handshake timeout'
                        );
                        resolve(new GGSocket(adapter, {connectionContext: context}));
                    });
                } catch (error) {
                    reject(error);
                }
            });
            adapter.onError((error: Error) => {
                reject(error);
            });
        });
    }
}
