import {GGSocket} from '../socket/GGSocket';
import {SocketAdapter} from "../socket/SocketAdapter";
import {GG_WS_CONNECTION} from "../server/GG_WS_CONNECTION";
import {Message, MessageType} from "../socket/SocketMessage";
import {GGValidator} from "@grest-ts/schema";
import {GGContext, GGContextStore, type GGTransportMiddleware} from "@grest-ts/context";
import {GG_TRACE} from "@grest-ts/trace";
import {getDefaultAdapter} from "../adapter/getDefaultAdapter";
import {awaitHandshakeResponse, buildHandshakeHeaders, buildWsUrl, gateMiddlewares} from "./clientHandshake";

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

    private static buildHeaders(config: GGSocketPoolConfig<any>): Record<string, string> {
        return buildHandshakeHeaders(config.middlewares ?? []);
    }

    static async getOrConnect<Query>(
        config: GGSocketPoolConfig<Query>
    ): Promise<GGSocket> {
        await gateMiddlewares(config.middlewares);
        const headers = this.buildHeaders(config);
        const fullUrl = this.buildUrl(config);

        // Create connection key based on URL + headers
        const headerKey = Object.entries(headers).sort().map(([k, v]) => `${k}=${v}`).join('&');
        const key = fullUrl + "::" + headerKey;

        const existing = this.sockets.get(key);
        if (existing) {
            return existing;
        }
        const pending = this.pendingSockets.get(key);
        if (pending) {
            return pending;
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

    private static buildUrl(config: GGSocketPoolConfig<any>): string {
        return buildWsUrl(config.domain, config.path, config.query);
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
                        await gateMiddlewares(config.middlewares);
                        const headers = this.buildHeaders(config);
                        adapter.send(Message.create(MessageType.HANDSHAKE, "", "", headers));
                        await awaitHandshakeResponse(adapter, 5000);
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
