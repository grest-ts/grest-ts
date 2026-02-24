import {GGSocket} from '../socket/GGSocket';
import {GGWebSocketHandshakeContext, GGWebSocketMiddleware} from "../schema/GGWebSocketMiddleware";
import {SocketAdapter} from "../socket/SocketAdapter";
import {GG_WS_CONNECTION} from "../server/GG_WS_CONNECTION";
import {Message, MessageType} from "../socket/SocketMessage";
import {GGValidator, SERVER_ERROR} from "@grest-ts/schema";
import {withTimeout} from "@grest-ts/common";
import {GGContext} from "@grest-ts/context";
import {GG_TRACE} from "@grest-ts/trace";
import {getDefaultAdapter} from "../adapter/getDefaultAdapter";

export interface GGSocketPoolConfig<Query> {
    domain: string,
    path: string,
    query?: Query
    queryValidator?: GGValidator<Query>
    middlewares?: readonly GGWebSocketMiddleware[]
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
     * Build headers from middlewares' updateHandshake()
     */
    private static buildHeaders(config: GGSocketPoolConfig<any>): Record<string, string> {
        if (!config.middlewares) {
            return {};
        }

        const handshakeContext: GGWebSocketHandshakeContext = {
            headers: {},
            queryArgs: (config.query as Record<string, string>) ?? {}
        };

        for (const middleware of config.middlewares) {
            middleware.updateHandshake?.(handshakeContext);
        }

        return handshakeContext.headers;
    }

    static async getOrConnect<Query>(
        config: GGSocketPoolConfig<Query>
    ): Promise<GGSocket> {
        // Build headers from middlewares
        const headers = this.buildHeaders(config);

        // Build full URL with query string if provided
        let fullUrl = config.domain + config.path;
        if (config.query) {
            const queryEntries: [string, string][] = Object.entries(config.query).map(([key, value]) => [key, String(value)]);
            fullUrl += '?' + new URLSearchParams(queryEntries).toString();
        }

        // Create connection key based on URL + headers
        const headerKey = Object.entries(headers).sort().map(([k, v]) => `${k}=${v}`).join('&');
        const key = fullUrl + "::" + headerKey;

        // Check for existing connection first
        if (this.sockets.has(key)) {
            return this.sockets.get(key);
        }
        if (this.pendingSockets.has(key)) {
            return this.pendingSockets.get(key);
        }

        // Create the connection promise BEFORE any async operations to prevent race conditions
        // This ensures that concurrent calls will see the pending promise
        const connectionPromise = (async () => {
            // Ensure adapter is loaded (this is async but safely inside the promise)
            const adapterClass = await this.ensureAdapter();

            return new Promise<GGSocket>((resolve, reject) => {
                const adapter = new adapterClass(fullUrl);
                adapter.onOpen(async () => {
                    try {
                        const context = new GGContext("ws-client-connection");
                        await context.run(async () => {
                            GG_TRACE.init();
                            GG_WS_CONNECTION.set({
                                port: undefined,
                                path: config.domain
                            });

                            // Send handshake with headers
                            adapter.send(Message.create(MessageType.HANDSHAKE, "", "", headers));

                            // Wait for handshake response
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
                                            handshakeReject(new SERVER_ERROR({
                                                displayMessage: 'WebSocket handshake failed',
                                                originalError: msg.data
                                            }));
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
        })();

        // Store the pending promise IMMEDIATELY (before awaiting)
        this.pendingSockets.set(key, connectionPromise);

        try {
            const socket = await connectionPromise;

            // Store the connection
            this.sockets.set(key, socket);
            this.pendingSockets.delete(key);

            // Clean up on close
            socket.onClose(() => {
                this.sockets.delete(key);
            });

            return socket;
        } catch (error) {
            // Clean up failed connection attempt
            this.pendingSockets.delete(key);
            throw error;
        }
    }
}
