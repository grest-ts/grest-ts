import WebSocket from 'ws';
import {GGLog} from "@grest-ts/logger";
import {GGLocator} from "@grest-ts/locator";

export enum IPCMessageType {
    MSG = 'm',
    REQ = 'r',
    RES = 's'
}

export interface IPCMessage {
    type: IPCMessageType;
    id: string;
    path: string;
    data?: unknown;
}

export type IPCMessageHandler = (data: unknown) => void | Promise<void>;
export type IPCRequestHandler = (data: unknown) => Promise<unknown>;

interface PendingRequest {
    resolve: (data: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}

export class IPCSocket {

    private readonly ws: WebSocket;
    private readonly messageHandlers: Map<string, IPCMessageHandler> = new Map();
    private readonly requestHandlers: Map<string, IPCRequestHandler> = new Map();
    private readonly pendingRequests: Map<string, PendingRequest> = new Map();

    private requestIdCounter = 0;
    private active = true;

    private readonly closeCallbacks: Array<() => void> = [];
    private readonly errorCallbacks: Array<(error: Error) => void> = [];

    constructor(ws: WebSocket) {
        this.ws = ws;
        const scope = GGLocator.getScope();

        ws.on('message', async (data: Buffer) => {
            scope.ensureEntered();
            await this.handleRawMessage(data.toString('utf8'));
        });

        ws.on('close', () => {
            scope.ensureEntered();
            this.active = false;
            for (const pending of this.pendingRequests.values()) {
                clearTimeout(pending.timeout);
                pending.reject(new Error('Connection closed'));
            }
            this.pendingRequests.clear();
            this.closeCallbacks.forEach(cb => {
                try {
                    cb();
                } catch (e) { /* ignore */
                }
            });
        });

        ws.on('error', (error: Error) => {
            scope.ensureEntered();
            this.errorCallbacks.forEach(cb => {
                try {
                    cb(error);
                } catch (e) { /* ignore */
                }
            });
        });
    }

    private static DELIMITER = ':';

    private static serialize(msg: IPCMessage): string {
        const dataStr = msg.data !== undefined ? JSON.stringify(msg.data) : '';
        return `${msg.type}${this.DELIMITER}${msg.id}${this.DELIMITER}${msg.path}${this.DELIMITER}${dataStr}`;
    }

    private static parse(raw: string): IPCMessage | undefined {
        const parts = raw.split(this.DELIMITER);
        if (parts.length < 3) return undefined;

        const type = parts[0] as IPCMessageType;
        const id = parts[1];
        const path = parts[2];
        const dataStr = parts.length > 3 ? parts.slice(3).join(this.DELIMITER) : '';

        let data: unknown;
        if (dataStr) {
            try {
                data = JSON.parse(dataStr);
            } catch {
                // Invalid JSON
            }
        }

        return {type, id, path, data};
    }

    private async handleRawMessage(raw: string): Promise<void> {
        const msg = IPCSocket.parse(raw);
        if (!msg) {
            GGLog.warn(this, `Invalid IPC message: ${raw.substring(0, 100)}`);
            return;
        }

        switch (msg.type) {
            case IPCMessageType.MSG:
                await this.handleIncomingMessage(msg);
                break;
            case IPCMessageType.REQ:
                await this.handleIncomingRequest(msg);
                break;
            case IPCMessageType.RES:
                this.handleIncomingResponse(msg);
                break;
        }
    }

    private async handleIncomingMessage(msg: IPCMessage): Promise<void> {
        const handler = this.messageHandlers.get(msg.path);
        if (!handler) {
            GGLog.debug(this, `No handler for message: ${msg.path}`);
            return;
        }
        try {
            await handler(msg.data);
        } catch (error) {
            GGLog.error(this, `Message handler error for ${msg.path}`, error);
        }
    }

    private async handleIncomingRequest(msg: IPCMessage): Promise<void> {
        const handler = this.requestHandlers.get(msg.path);

        const sendResponse = (success: boolean, data?: unknown, error?: string) => {
            if (this.ws.readyState === WebSocket.OPEN) {
                const response: IPCMessage = {
                    type: IPCMessageType.RES,
                    id: msg.id,
                    path: msg.path,
                    data: {success, data, error}
                };
                this.ws.send(IPCSocket.serialize(response));
            }
        };

        if (!handler) {
            sendResponse(false, undefined, `No handler for: ${msg.path}`);
            return;
        }

        try {
            const result = await handler(msg.data);
            sendResponse(true, result);
        } catch (error: any) {
            GGLog.error(this, `Request handler error for ${msg.path}`, error);
            sendResponse(false, undefined, error.message || String(error));
        }
    }

    private handleIncomingResponse(msg: IPCMessage): void {
        const pending = this.pendingRequests.get(msg.id);
        if (!pending) {
            GGLog.debug(this, `No pending request for response id: ${msg.id}`);
            return;
        }

        clearTimeout(pending.timeout);
        this.pendingRequests.delete(msg.id);

        const response = msg.data as { success: boolean; data?: unknown; error?: string };
        if (response.success) {
            pending.resolve(response.data);
        } else {
            pending.reject(new Error(response.error || 'Request failed'));
        }
    }

    public onMessage(path: string, handler: IPCMessageHandler): void {
        this.messageHandlers.set(path, handler);
    }

    public onRequest(path: string, handler: IPCRequestHandler): void {
        this.requestHandlers.set(path, handler);
    }

    public onClose(callback: () => void): void {
        this.closeCallbacks.push(callback);
    }

    public onError(callback: (error: Error) => void): void {
        this.errorCallbacks.push(callback);
    }

    public send(path: string, data?: unknown): void {
        if (!this.active || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Socket not connected');
        }
        const msg: IPCMessage = {type: IPCMessageType.MSG, id: '', path, data};
        this.ws.send(IPCSocket.serialize(msg));
    }

    public async request<T = unknown>(path: string, data?: unknown, timeoutMs: number = 10000): Promise<T> {
        if (!this.active || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Socket not connected');
        }

        const id = `${++this.requestIdCounter}`;
        const msg: IPCMessage = {type: IPCMessageType.REQ, id, path, data};

        return new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request '${path}' timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this.pendingRequests.set(id, {
                resolve: resolve as (data: unknown) => void,
                reject,
                timeout
            });

            this.ws.send(IPCSocket.serialize(msg));
        });
    }

    public isConnected(): boolean {
        return this.active && this.ws.readyState === WebSocket.OPEN;
    }

    public close(): void {
        if (this.active) {
            this.active = false;
            this.ws.terminate();
        }
    }

    public teardown(): void {
        for (const pending of this.pendingRequests.values()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Socket teardown'));
        }
        this.pendingRequests.clear();
        this.close();
    }
}
