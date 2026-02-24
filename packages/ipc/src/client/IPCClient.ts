import WebSocket from 'ws';
import {GGLog} from "@grest-ts/logger";
import {GGLocator} from "@grest-ts/locator";
import {INTERNAL_SOCKET_PATH} from "../server/SocketHandler";
import {IPCSocket} from "../common/IPCSocket";
import {IPCClientRequest, IPCServerRequest} from "../common/IPCTypes";

export class IPCClient {

    private readonly url: string;
    private socket?: IPCSocket;

    constructor(port: number) {
        this.url = "localhost:" + port;
    }

    public static defineRequest<Req, Res>(name: string): IPCClientRequest<Req, Res> {
        return name as IPCClientRequest<Req, Res>;
    }

    // -----------------------------------------------------

    public onFrameworkRequest<Req, Res>(
        type: IPCClientRequest<Req, Res>,
        handler: (payload: Req) => Promise<Res>
    ): void {
        this.getSocket().onRequest(type, async (data) => handler(data as Req));
    }

    public async sendFrameworkRequest<Req, Res>(
        type: IPCServerRequest<Req, Res>,
        payload: Req,
        timeoutMs: number = 10000
    ): Promise<Res> {
        return this.getSocket().request<Res>(type, payload, timeoutMs);
    }

    // -----------------------------------------------------

    public async connect(runtimeId?: string): Promise<void> {
        if (this.socket?.isConnected()) return;

        // Capture scope before async boundary - WebSocket events don't preserve AsyncLocalStorage context
        const scope = GGLocator.getScope();

        return new Promise((resolve, reject) => {
            const queryParam = runtimeId ? `?runtimeId=${encodeURIComponent(runtimeId)}` : '';
            const url = `ws://${this.url}${INTERNAL_SOCKET_PATH}${queryParam}`;
            const ws = new WebSocket(url);

            const timeout = setTimeout(() => {
                ws.terminate();
                reject(new Error(`Connection timeout to ${this.url}`));
            }, 5000);

            ws.on('open', () => {
                scope.ensureEntered();
                clearTimeout(timeout);
                this.socket = new IPCSocket(ws);
                GGLog.debug(this, `Connected to IPC server at ${this.url}`);
                resolve();
            });

            ws.on('error', (err) => {
                scope.ensureEntered();
                clearTimeout(timeout);
                if (!this.socket) {
                    reject(err);
                } else {
                    GGLog.error(this, 'Socket error', err);
                }
            });
        });
    }

    public disconnect(): void {
        if (this.socket) {
            this.socket.teardown();
            this.socket = undefined;
        }
    }

    public onClose(handler: () => void): void {
        this.getSocket().onClose(handler);
    }

    public isConnected(): boolean {
        return this.socket?.isConnected() ?? false;
    }

    // -----------------------------------------------------

    private getSocket(): IPCSocket {
        if (!this.socket) {
            throw new Error('Not connected to IPC server');
        }
        return this.socket;
    }
}
