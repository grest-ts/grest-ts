/**
 * Manages WebSocket connections for a single endpoint
 * Handles connection acceptance, effect parsing via handshake, and socket lifecycle
 */

import {WebSocket, WebSocketServer} from "ws";
import {ERROR, GGValidator} from "@grest-ts/schema";
import {NodeSocketAdapter} from "../adapter/NodeSocketAdapter";
import * as http from "http";
import * as url from "url";
import {GGLog} from "@grest-ts/logger";
import {GG_WS_CONNECTION} from "./GG_WS_CONNECTION";
import {GGWebSocketMetrics} from "./GGWebSocketMetrics";
import {Message, MessageType} from "../socket/SocketMessage";
import {GG_TRACE} from "@grest-ts/trace";
import {GGSocket, GGSocketLogger, GGSocketMetrics, type GGHeartbeatConfig} from "../socket/GGSocket";
import {GGLocator, GGLocatorScope} from "@grest-ts/locator";
import {GG_METRICS} from "@grest-ts/metrics";
import {withTimeout} from "@grest-ts/common";
import {GGContext, type GGInbound, type GGTransportMiddleware} from "@grest-ts/context";
import {GG_DISCOVERY} from "@grest-ts/discovery";
import {GGHttpServer} from "@grest-ts/http";
import {GGRawSocket} from "../socket/GGRawSocket";

/**
 * Per-connection liveness heartbeat: the server pings each client and reaps sockets
 * that stop responding, so NAT/proxy/LB idle timeouts can't silently sever the link.
 * On by default; pass `false` to disable.
 */
export type GGServerHeartbeatOption = GGHeartbeatConfig | false;

/**
 * The HTTP upgrade behind a byte-stream connection, handed to the `onConnection` handler.
 * The point of access for a `customClient` proxy (e.g. code-server): `path` is the concrete
 * request pathname — for a `"/base/*"` prefix schema, the actual subpath the foreign client
 * opened — and `headers` are the upgrade headers (to forward upstream). Exposes a clean value,
 * not the Node request object.
 */
export interface GGWsUpgrade {
    /** Request pathname (no query). For a "/base/*" prefix socket, the concrete matched subpath. */
    path: string;
    /** Full request URL including the query string. */
    url: string;
    /** Upgrade request headers; multi-value headers are joined with ", ". */
    headers: Record<string, string | undefined>;
    /** Remote peer address of the upgrade TCP socket — e.g. to gate a loopback-only endpoint. */
    remoteAddress?: string;
}

function toUpgrade(req: http.IncomingMessage): GGWsUpgrade {
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(", ") : v;
    const url = req.url ?? "";
    return {path: url.split('?')[0], url, headers, remoteAddress: req.socket.remoteAddress};
}

export interface GGSocketServerConfig<TContext, Query> {
    path: string;
    apiName: string;
    queryValidator?: GGValidator<Query>;
    middlewares: readonly GGTransportMiddleware[];
    heartbeat?: GGServerHeartbeatOption;
    /**
     * Raw mode: skip the typed message layer. After the handshake (query validation +
     * middleware/wire auth) succeeds, the connection handler receives a GGRawSocket
     * instead of a GGSocket and owns the wire as an opaque byte stream.
     */
    raw?: boolean;
    /**
     * Custom-client mode (implies raw): auth runs against the HTTP upgrade request, not an
     * in-band handshake, and no HANDSHAKE_OK is sent — for foreign clients that can't
     * speak the grest-ts handshake. See GGRawSocketContract.customClient.
     */
    customClient?: boolean;
    /** Subprotocols to echo (customClient); first client-requested match wins. */
    protocols?: readonly string[];
}

/** Anything the server tracks for graceful teardown — a schema socket or a raw stream. */
type ServerSocket = {teardown(): Promise<void>};

/**
 * Shared path-dispatching upgrade registry per http.Server.
 *
 * The `ws` library's `{server, path}` mode aborts the HTTP handshake with 400
 * whenever the upgrade path doesn't match — so attaching two WebSocketServer
 * instances to the same http.Server causes whichever one fires first to reject
 * requests meant for the other. We install a single shared 'upgrade' listener
 * on each http.Server and dispatch by path instead. Raw byte-stream sockets are
 * also path-registered WebSocketServers, so they coexist here automatically.
 */
interface WsRegistry {
    readonly wssByPath: Map<string, WebSocketServer>
    // Wildcard prefix routes (a `customClient` "/base/*" schema). Foreign apps (code-server,
    // a proxied editor) open sockets at dynamic subpaths, so an exact match can't catch them.
    readonly prefixRoutes: Array<{base: string; wss: WebSocketServer}>
}

const wsRegistryByHttpServer = new WeakMap<http.Server, WsRegistry>();

/** Longest matching prefix wins; "/base/*" matches "/base" and anything under "/base/". */
function matchPrefix(routes: ReadonlyArray<{base: string; wss: WebSocketServer}>, pathname: string): WebSocketServer | undefined {
    let best: WebSocketServer | undefined;
    let bestLen = -1;
    for (const {base, wss} of routes) {
        if ((pathname === base || pathname.startsWith(base + '/')) && base.length > bestLen) {
            best = wss;
            bestLen = base.length;
        }
    }
    return best;
}

function ensureRegistry(httpServer: http.Server): WsRegistry {
    let registry = wsRegistryByHttpServer.get(httpServer);
    if (registry) return registry;
    registry = {wssByPath: new Map(), prefixRoutes: []};
    wsRegistryByHttpServer.set(httpServer, registry);
    const captured = registry;
    httpServer.on('upgrade', (req, socket, head) => {
        const pathname = (req.url ?? '').split('?')[0];
        // Exact registrations take precedence, so a specific path can override a broad "/x/*" prefix.
        const matched = captured.wssByPath.get(pathname) ?? matchPrefix(captured.prefixRoutes, pathname);
        if (matched) {
            matched.handleUpgrade(req, socket, head, (ws) => {
                matched.emit('connection', ws, req);
            });
            return;
        }
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
    });
    return registry;
}

function attachUpgradeDispatch(httpServer: http.Server, path: string, wss: WebSocketServer): void {
    const registry = ensureRegistry(httpServer);
    if (path.endsWith('/*')) {
        const base = path.slice(0, -2);
        if (registry.prefixRoutes.some(r => r.base === base)) {
            throw new Error(`WebSocket prefix path "${path}" is already registered on this HTTP server.`);
        }
        registry.prefixRoutes.push({base, wss});
        return;
    }
    if (registry.wssByPath.has(path)) {
        throw new Error(`WebSocket path "${path}" is already registered on this HTTP server.`);
    }
    registry.wssByPath.set(path, wss);
}

function detachUpgradeDispatch(httpServer: http.Server, path: string): void {
    const registry = wsRegistryByHttpServer.get(httpServer);
    if (!registry) return;
    if (path.endsWith('/*')) {
        const base = path.slice(0, -2);
        const i = registry.prefixRoutes.findIndex(r => r.base === base);
        if (i >= 0) registry.prefixRoutes.splice(i, 1);
        return;
    }
    registry.wssByPath.delete(path);
}

export class GGSocketServer<TContext, Query, TSocket extends ServerSocket = GGSocket> {

    private readonly wss: WebSocketServer;
    private readonly http: GGHttpServer;
    public readonly path: string;
    private readonly apiName: string;
    private readonly middlewares: readonly GGTransportMiddleware[];
    private readonly queryValidator?: GGValidator<Query>;
    private readonly heartbeat: GGServerHeartbeatOption;
    private readonly raw: boolean;
    private readonly customClient: boolean;

    private readonly activeSockets: Set<ServerSocket> = new Set();
    private readonly onConnectionHandlers: Array<(socket: TSocket, query: Query, upgrade: GGWsUpgrade) => Promise<void>> = [];

    // Capture context at construction - WebSocket events lose AsyncLocalStorage context
    private readonly scope: GGLocatorScope;

    constructor(http: GGHttpServer, config: GGSocketServerConfig<TContext, Query>) {
        this.scope = GGLocator.getScope();
        this.path = config.path;
        this.apiName = config.apiName;
        this.middlewares = config.middlewares;
        this.queryValidator = config.queryValidator;
        this.heartbeat = config.heartbeat ?? {};
        this.raw = config.raw ?? false;
        this.customClient = config.customClient ?? false;
        const protocols = config.protocols;
        this.wss = new WebSocketServer({
            noServer: true,
            // Custom (foreign) clients (e.g. noVNC) refuse a connection whose requested
            // Sec-WebSocket-Protocol isn't echoed. Echo the first offered protocol we allow.
            ...(protocols && protocols.length
                ? {handleProtocols: (offered: Set<string>) => protocols.find(p => offered.has(p)) ?? false}
                : {}),
        });
        this.wss.on('connection', this.scope.wrapWithEnter(this._onConnection));
        attachUpgradeDispatch(http.httpServer, this.path, this.wss);
        this.http = http
            .onStart(() => {
                GGLog.info(this, "WebSocket server started", {api: config.apiName, path: config.path});
                if (GG_DISCOVERY.has()) {
                    GG_DISCOVERY.get().registerRoutes([{
                        runtime: this.scope.serviceName,
                        api: this.apiName,
                        // Discovery routes by startsWith(pathPrefix); a "/base/*" wildcard schema
                        // registers its base so subpath upgrades resolve to this server.
                        pathPrefix: this.path.endsWith('/*') ? this.path.slice(0, -2) : this.path,
                        protocol: "ws",
                        // onStart fires after the http server has bound its port.
                        port: http.port!
                    }]);
                }
            })
            .onTeardown(async () => {
                GGLog.info(this, "WebSocket server closing");
                try {
                    detachUpgradeDispatch(http.httpServer, this.path);
                    this.wss.close();
                } catch (error) {
                    GGLog.error(this, error instanceof Error ? error : new Error(String(error)));
                }
                await Promise.allSettled(Array.from(this.activeSockets).map(socket => socket.teardown()));
                GGLog.info(this, "WebSocket server stopped");
            });
    }

    public onConnection(handler: (socket: TSocket, query: Query, upgrade: GGWsUpgrade) => Promise<void>): void {
        this.onConnectionHandlers.push(handler);
    }

    private _onConnection = async (ws: WebSocket, req: http.IncomingMessage) => {
        const connectionLabels = {api: this.apiName, path: this.path};

        const context = new GGContext("ws-connection", undefined, true);
        await context.run(async () => {
            GG_TRACE.init()
            GG_WS_CONNECTION.set({
                port: this.http.port,
                path: this.path
            })
            try {
                // Parse and validate query parameters
                const parsedUrl = url.parse(req.url || '', true);
                let queryArgs = parsedUrl.query as Query;

                if (this.queryValidator) {
                    const result = this.queryValidator.safeParse(queryArgs, true)
                    if (result.success === false) {
                        ws.close(4000, "Invalid query parameters");
                        GGLog.warn(this, "REJECTED - bad query", result.issues);
                        if (GG_METRICS.has()) GGWebSocketMetrics.connections.inc(1, {...connectionLabels, result: 'QUERY_INVALID'});
                        return;
                    }
                    queryArgs = result.value as Query
                }

                const adapter = new NodeSocketAdapter(ws);
                const upgrade = toUpgrade(req);

                // The cookie from the real upgrade request — a browser auto-attaches it to the
                // upgrade GET, but cannot set it on the in-band handshake message, so this is the
                // only spoof-proof source for a WebSocket cookie.
                const cookie = typeof req.headers.cookie === "string" ? req.headers.cookie : undefined;

                // Custom client: a foreign client (noVNC, a proxied app) can't send the in-band
                // handshake, so auth runs against the upgrade request itself and the byte stream
                // is live immediately — no HANDSHAKE_OK round-trip.
                if (this.customClient) {
                    // A client that speaks first (not VNC, which waits for the server greeting)
                    // could emit frames during the auth await, before the handler attaches its
                    // listener — pause the socket across that gap and resume once it's wired.
                    ws.pause();
                    const authed = await this.runUpgradeAuth(upgrade, queryArgs, cookie);
                    if (!authed.success) {
                        GGLog.warn(this, "REJECTED - upgrade auth failed", (authed as { success: false; error: any }).error);
                        if (GG_METRICS.has()) GGWebSocketMetrics.connections.inc(1, {...connectionLabels, result: 'HANDSHAKE_FAILED'});
                        ws.close(4001, "Unauthorized");
                        return;
                    }
                    await this.openRawConnection(adapter, context, queryArgs, upgrade, connectionLabels, false);
                    ws.resume();
                    return;
                }

                // Wait for handshake message with headers
                const handshakeResult = await this.handleHandshake(context, adapter, queryArgs, cookie);

                if (!handshakeResult.success) {
                    GGLog.warn(this, "REJECTED - handshake failed", (handshakeResult as { success: false; error: any }).error);
                    if (GG_METRICS.has()) GGWebSocketMetrics.connections.inc(1, {...connectionLabels, result: 'HANDSHAKE_FAILED'});
                    adapter.send(Message.create(MessageType.HANDSHAKE_ERR, "", "", (handshakeResult as { success: false; error: any }).error));
                    ws.close(4001, "Handshake failed");
                    return;
                }

                if (this.raw) {
                    await this.openRawConnection(adapter, context, queryArgs, upgrade, connectionLabels, true);
                    return;
                }

                // Send handshake success
                adapter.send(Message.create(MessageType.HANDSHAKE_OK, "", "", null));

                GGLog.debug(this, "New websocket connection", queryArgs);
                const socket = new GGSocket(adapter, {
                    apiName: this.apiName,
                    socketPath: this.path,
                    connectionContext: context,
                    scope: this.scope,
                    metrics: this.createMetrics(),
                    log: this.createLogger(),
                });
                this.activeSockets.add(socket);

                if (this.heartbeat !== false) socket.startHeartbeat(this.heartbeat);

                // Track connection metrics
                if (GG_METRICS.has()) {
                    GGWebSocketMetrics.connections.inc(1, {...connectionLabels, result: 'OK'});
                    GGWebSocketMetrics.connectionsActive.inc(1, connectionLabels);
                }

                socket.onClose(() => {
                    this.activeSockets.delete(socket);
                    if (GG_METRICS.has()) GGWebSocketMetrics.connectionsActive.dec(1, connectionLabels);
                });

                // Run connection handlers inside the connectionScope so they can access context
                for (const handler of this.onConnectionHandlers) {
                    try {
                        await handler(socket as unknown as TSocket, queryArgs, upgrade);
                    } catch (error) {
                        GGLog.error(this, error instanceof Error ? error : new Error(String(error)));
                    }
                }
            } catch (error) {
                GGLog.error(this, error instanceof Error ? error : new Error(String(error)));
                if (GG_METRICS.has()) GGWebSocketMetrics.connections.inc(1, {...connectionLabels, result: 'ERROR'});
                // Only close if socket is still open (fix #5 - avoid double close)
                if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
                    ws.close(4001, "Connection rejected");
                }
            }
        });
    }

    /**
     * Run the auth middlewares/wires against the HTTP upgrade request (custom-client mode):
     * credentials ride the upgrade headers / cookie / query, not an in-band message. Runs in
     * the connection context (the caller is inside `context.run`) so the durable principal a
     * wire mints persists for the handlers.
     */
    private async runUpgradeAuth(
        upgrade: GGWsUpgrade,
        queryArgs: Query,
        cookie: string | undefined
    ): Promise<{ success: true } | { success: false; error: any }> {
        try {
            const inbound: GGInbound = {headers: upgrade.headers, cookie, query: queryArgs as Record<string, string>};
            for (const middleware of this.middlewares) middleware.parse?.(inbound);
            try {
                for (const middleware of this.middlewares) await middleware.process?.();
            } finally {
                for (const middleware of this.middlewares) middleware.clear?.();
            }
            return {success: true};
        } catch (error: any) {
            return {success: false, error: error instanceof ERROR ? error.toJSON() : {message: String(error)}};
        }
    }

    /**
     * Raw mode: the handshake (query + auth) already passed. Build a GGRawSocket, let the
     * connection handlers attach their byte listeners, THEN send HANDSHAKE_OK (when the client
     * speaks the grest-ts handshake) — so it only starts streaming once the server is listening
     * (no first-frame race). Custom clients get no HANDSHAKE_OK (`sendHandshakeOk=false`).
     */
    private async openRawConnection(
        adapter: NodeSocketAdapter,
        context: GGContext,
        queryArgs: Query,
        upgrade: GGWsUpgrade,
        connectionLabels: {api: string; path: string},
        sendHandshakeOk: boolean
    ): Promise<void> {
        GGLog.debug(this, "New raw websocket connection", queryArgs);
        const socket = new GGRawSocket(adapter, {
            apiName: this.apiName,
            socketPath: this.path,
            connectionContext: context,
            scope: this.scope,
            metrics: this.createMetrics(),
            log: this.createLogger(),
        });
        this.activeSockets.add(socket);

        if (this.heartbeat !== false) socket.startHeartbeat(this.heartbeat);

        if (GG_METRICS.has()) {
            GGWebSocketMetrics.connections.inc(1, {...connectionLabels, result: 'OK'});
            GGWebSocketMetrics.connectionsActive.inc(1, connectionLabels);
        }

        socket.onClose(() => {
            this.activeSockets.delete(socket);
            if (GG_METRICS.has()) GGWebSocketMetrics.connectionsActive.dec(1, connectionLabels);
        });

        for (const handler of this.onConnectionHandlers) {
            try {
                await handler(socket as unknown as TSocket, queryArgs, upgrade);
            } catch (error) {
                GGLog.error(this, error instanceof Error ? error : new Error(String(error)));
            }
        }

        if (sendHandshakeOk) adapter.send(Message.create(MessageType.HANDSHAKE_OK, "", "", null));
    }

    private createLogger(): GGSocketLogger {
        return {
            debug: (source: any, message: string) => GGLog.debug(source, message),
            warn: (source: any, message: string) => GGLog.warn(source, message),
            error: (source: any, ...args: any[]) => GGLog.error(source, ...(args as [any])),
        }
    }

    private createMetrics(): GGSocketMetrics | undefined {
        if (!GG_METRICS.has()) return undefined;
        return {
            recordIn(labels, result, startTime) {
                GGWebSocketMetrics.requests.inc(1, {...labels, result});
                if (startTime !== undefined) {
                    GGWebSocketMetrics.requestDuration.observe(performance.now() - startTime, labels);
                }
            },
            recordOut(labels, result, startTime) {
                GGWebSocketMetrics.outRequests.inc(1, {...labels, result});
                if (startTime !== undefined) {
                    GGWebSocketMetrics.outRequestDuration.observe(performance.now() - startTime, labels);
                }
            },
            recordHeartbeatTimeout(labels) {
                GGWebSocketMetrics.heartbeatTimeouts.inc(1, labels);
            },
        };
    }

    /**
     * Handle handshake message from client.
     * Waits for HANDSHAKE message with headers, runs effects, returns context.
     */
    private async handleHandshake(
        context: GGContext,
        adapter: NodeSocketAdapter,
        queryArgs: Query,
        cookie: string | undefined
    ): Promise<{ success: true } | { success: false; error: any }> {
        type HandshakeResult = { success: true } | { success: false; error: any };
        return withTimeout<HandshakeResult>(
            new Promise<HandshakeResult>((resolve) => {
                // Wrap with scope.wrapWithEnter to preserve locator scope when callback fires
                const onMessage = this.scope.wrapWithEnter((data: string) => {
                    const msg = Message.parse(data);
                    if (!msg) return;

                    if (msg.type === MessageType.HANDSHAKE) {
                        adapter.offMessage(onMessage);
                        context.run(async () => {
                            try {
                                const inbound: GGInbound = {
                                    headers: msg.data || {},
                                    cookie,
                                    query: queryArgs as Record<string, string>
                                };
                                for (const middleware of this.middlewares) middleware.parse?.(inbound);
                                // Drop ephemeral raw credentials before the connection opens (and even
                                // when a process() rejects the handshake); the durable principal a smart
                                // wire minted persists on the connection context.
                                try {
                                    for (const middleware of this.middlewares) await middleware.process?.();
                                } finally {
                                    for (const middleware of this.middlewares) middleware.clear?.();
                                }
                                resolve({success: true});
                            } catch (error: any) {
                                const errorJson = error instanceof ERROR
                                    ? error.toJSON()
                                    : {message: String(error)};
                                resolve({success: false, error: errorJson});
                            }
                        });
                    }
                });

                adapter.onMessage(onMessage);
            }),
            5000,
            'Handshake timeout'
        ).catch((error): { success: false; error: any } => ({
            success: false,
            error: {message: error.message || 'Handshake timeout'}
        }));
    }
}
