import * as http from 'http';
import * as net from 'net';
import {GGLog} from "@grest-ts/logger";
import {Duplex} from "stream";
import {HttpMethod} from "@grest-ts/common";
import {HttpHandler} from "./HttpHandler";
import {SocketHandler, SocketMessage} from "./SocketHandler";
import {IPCClientRequest, IPCServerRequest} from "../common/IPCTypes";
import {GGLocator, GGLocatorScope} from "@grest-ts/locator";
import {GGContext} from "@grest-ts/context";
import {GG_TRACE} from "@grest-ts/trace";

export class IPCServer {

    private readonly httpServer: http.Server;
    private readonly httpHandler: HttpHandler;
    private readonly socketHandler: SocketHandler;

    private readonly expectedPort: number;
    private port: number = 0;
    private url: string = '';

    private readonly connections: Set<net.Socket> = new Set();

    private readonly scope: GGLocatorScope;

    constructor(port: number = 0) {
        this.expectedPort = port;
        this.scope = GGLocator.getScope();

        // Create handlers
        this.httpHandler = new HttpHandler();
        this.socketHandler = new SocketHandler();

        // Create HTTP server
        this.httpServer = http.createServer(async (req, res) => {
            await new GGContext("LocalRouter").run(async () => {
                GG_TRACE.init();
                await this.httpHandler.handleRequest(req, res);
            });
        });

        // Handle WebSocket upgrades
        // Note: Incoming TCP connections start with no async context (they originate from libuv/OS layer).
        this.httpServer.on('upgrade', async (req, socket, head) => {
            this.scope.ensureEntered();
            await new GGContext("LocalRouter").run(async () => {
                GG_TRACE.init();
                await this.socketHandler.handleUpgrade(req, socket as Duplex, head);
            });
        });

        // Track connections for cleanup
        this.httpServer.on('connection', (conn) => {
            this.connections.add(conn);
            conn.on('close', () => this.connections.delete(conn));
        });
    }

    public static defineRequest<Req, Res>(name: string): IPCServerRequest<Req, Res> {
        return name as IPCServerRequest<Req, Res>;
    }

    // -----------------------------------------------
    // Lifecycle
    // -----------------------------------------------

    public async start(): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            const errorHandler = (err: any) => {
                if (err.code === 'EADDRINUSE') {
                    resolve(false);
                } else {
                    reject(err);
                }
            };

            this.httpServer.once('error', errorHandler);

            this.httpServer.listen(this.expectedPort, '0.0.0.0', () => {
                this.scope.ensureEntered();
                this.port = (this.httpServer.address() as any).port;
                this.url = `http://localhost:${this.port}`;
                this.httpServer.removeListener('error', errorHandler);
                GGLog.info(this, `Internal server started on port ${this.port}`);
                resolve(true);
            });
        });
    }

    public async teardown(): Promise<void> {
        // Teardown socket handler (closes clients and WSS)
        await this.socketHandler.teardown();

        // Close all HTTP connections
        this.connections.forEach(conn => conn.destroy());
        this.connections.clear();

        // Close the server
        await new Promise<void>((resolve, reject) => {
            this.httpServer.close((err) => {
                this.scope.ensureEntered();
                if (err) reject(err);
                else resolve();
            });
        });

        GGLog.info(this, 'Internal server stopped');
    }

    // -----------------------------------------------
    // Handling http/socket requests that services send between each other. Can intercept http here.
    // -----------------------------------------------

    public interceptHttp(method: HttpMethod, path: string, handler: (body: any, pathParams?: Record<string, string>, headers?: Record<string, string>) => Promise<any>): void {
        this.httpHandler.addRoute(method, path, handler);
    }

    public removeInterceptHttp(method: HttpMethod, path: string): void {
        this.httpHandler.removeRoute(method, path);
    }

    public setRouteProxyResolver(resolver: (path: string) => string) {
        this.httpHandler.setRouteResolver(resolver);
        this.socketHandler.setRouteResolver(resolver);
    }

    // -----------------------------------------------
    // Grest Framework internal messaging between either local discovery server or local test server.
    // -----------------------------------------------

    public onFrameworkMessage<Req, Res>(
        type: IPCServerRequest<Req, Res>,
        handler: (payload: Req, msg: SocketMessage) => Promise<Res>
    ): void {
        this.socketHandler.onMessage(type, async (msg) => handler(msg.data as Req, msg));
    }

    public async sendFrameworkMessage<Req, Res>(
        runtimeId: string,
        type: IPCClientRequest<Req, Res>,
        payload: Req,
        timeoutMs?: number
    ): Promise<Res> {
        return this.socketHandler.request<Res>(runtimeId, type, payload, timeoutMs);
    }

    // -----------------------------------------------
    // Accessors
    // -----------------------------------------------

    public getPort(): number {
        return this.port;
    }

    public getUrl(): string {
        return this.url;
    }
}
