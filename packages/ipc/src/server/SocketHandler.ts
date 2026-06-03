import * as http from 'http';
import {WebSocket, WebSocketServer} from 'ws';
import {GGLog} from "@grest-ts/logger";
import {Duplex} from "stream";
import {IPCSocket} from "../common/IPCSocket";
import httpProxy from "http-proxy";

export const INTERNAL_SOCKET_PATH = '/__ggFrameworkConnection';

export type WsUpgradeHandler = (req: http.IncomingMessage, socket: Duplex, head: Buffer) => Promise<boolean>;
export type SocketMessageHandler = (msg: SocketMessage) => Promise<unknown>;

export interface SocketMessage {
    clientId: string;
    runtimeId?: string;
    data: unknown;
}

interface SocketClient {
    id: string;
    runtimeId?: string;
    socket: IPCSocket;
}

export type ClientDisconnectListener = (clientId: string, runtimeId?: string) => void;

export class SocketHandler {

    private readonly wss: WebSocketServer;
    private readonly clients: Map<string, SocketClient> = new Map();
    private readonly clientsByRuntimeId: Map<string, SocketClient> = new Map();
    private readonly handlers: Map<string, SocketMessageHandler> = new Map();
    private readonly disconnectListeners: ClientDisconnectListener[] = [];
    private clientIdCounter = 0;

    private routeResolver!: (path: string) => string
    private readonly proxy: httpProxy;

    constructor() {
        this.wss = new WebSocketServer({noServer: true});
        this.proxy = httpProxy.createProxyServer({});
    }

    public setRouteResolver(routeResolver: (path: string) => string) {
        this.routeResolver = routeResolver
    }

    public onMessage(path: string, handler: SocketMessageHandler): void {
        this.handlers.set(path, handler);
    }

    /** Subscribe to client-disconnect events. Fires synchronously when a
     *  client's IPC websocket closes (graceful or violent). Listeners
     *  must not throw — errors are caught and logged so other listeners
     *  still run. */
    public onClientDisconnect(listener: ClientDisconnectListener): void {
        this.disconnectListeners.push(listener);
    }

    public async handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
        const url = req.url;
        if (!url) {
            socket.destroy();
            return;
        }
        if (url.startsWith(INTERNAL_SOCKET_PATH)) {
            this.wss.handleUpgrade(req, socket, head, (ws) => {
                this.handleNewConnection(ws, url);
            });
            return;
        }

        const routeToUrl = this.routeResolver(url)
        if (routeToUrl) {
            GGLog.debug(this, `Proxying WS ${req.url} -> ${routeToUrl}`);
            this.proxy.ws(req, socket, head, {target: routeToUrl}, (err: any) => {
                const code = err?.code ?? err?.errors?.[0]?.code ?? 'UNKNOWN';
                GGLog.error(this, `WebSocket proxy error [${code}] ${req.url} -> ${routeToUrl}: ${err.message}`);
                socket.destroy();
            });
            return;
        }

        socket.destroy();
    }

    private handleNewConnection(ws: WebSocket, url: string): void {
        const clientId = `client-${++this.clientIdCounter}`;

        let runtimeId: string | undefined;
        const queryStart = url.indexOf('?');
        if (queryStart !== -1) {
            const params = new URLSearchParams(url.substring(queryStart + 1));
            runtimeId = params.get('runtimeId') ?? undefined;
        }

        const ipcSocket = new IPCSocket(ws);

        const client: SocketClient = {id: clientId, runtimeId, socket: ipcSocket};
        this.clients.set(clientId, client);
        if (runtimeId) {
            this.clientsByRuntimeId.set(runtimeId, client);
        }

        GGLog.debug(this, `Socket client connected: ${clientId}` + (runtimeId ? ` (runtimeId: ${runtimeId})` : ''));

        for (const [path, handler] of this.handlers) {
            ipcSocket.onRequest(path, async (data) => {
                return handler({
                    clientId: client.id,
                    runtimeId: client.runtimeId,
                    data
                });
            });
        }

        ipcSocket.onClose(() => {
            this.clients.delete(clientId);
            if (runtimeId) {
                this.clientsByRuntimeId.delete(runtimeId);
            }
            GGLog.debug(this, `Socket client disconnected: ${clientId}`);
            for (const listener of this.disconnectListeners) {
                try {
                    listener(clientId, runtimeId);
                } catch (err) {
                    GGLog.error(this, `Client-disconnect listener threw for ${clientId}`, err);
                }
            }
        });

        ipcSocket.onError((err: Error) => {
            GGLog.debug(this, `Socket client error: ${clientId} - ${err.message}`);
        });
    }

    public async request<T = unknown>(
        runtimeId: string,
        path: string,
        data?: unknown,
        timeoutMs: number = 10000
    ): Promise<T> {
        const client = this.clientsByRuntimeId.get(runtimeId);
        if (!client) {
            throw new Error(`No client connected with runtimeId: ${runtimeId}`);
        }
        return client.socket.request<T>(path, data, timeoutMs);
    }

    public send(runtimeId: string, path: string, data?: unknown): void {
        const client = this.clientsByRuntimeId.get(runtimeId);
        if (!client) {
            throw new Error(`No client connected with runtimeId: ${runtimeId}`);
        }
        client.socket.send(path, data);
    }

    public async teardown(): Promise<void> {
        for (const client of this.clients.values()) {
            client.socket.teardown();
        }
        this.clients.clear();
        this.clientsByRuntimeId.clear();
        this.proxy.close();

        await new Promise<void>((resolve) => {
            this.wss.close(() => resolve());
        });
    }
}
