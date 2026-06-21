import WebSocket from "ws";
import {SocketAdapter} from "../socket/SocketAdapter";

export interface NodeSocketAdapterOptions {
    headers?: Record<string, string>;
}

export class NodeSocketAdapter implements SocketAdapter {
    private ws: WebSocket;
    private messageWrappers = new WeakMap<(data: string) => void, (rawMessage: Buffer) => void>();

    constructor(urlOrSocket: string | WebSocket, options?: NodeSocketAdapterOptions) {
        if (typeof urlOrSocket === 'string') {
            this.ws = new WebSocket(urlOrSocket, {
                headers: options?.headers
            });
        } else {
            this.ws = urlOrSocket;
        }
    }

    send(message: string): void {
        this.ws.send(message);
    }

    close(): void {
        this.ws.close();
    }

    onOpen(handler: () => void): void {
        this.ws.on('open', handler);
    }

    onMessage(handler: (data: string) => void): void {
        const wrapper = (rawMessage: Buffer) => handler(String(rawMessage))
        this.messageWrappers.set(handler, wrapper);
        this.ws.on('message', wrapper);
    }

    onClose(handler: () => void): void {
        this.ws.on('close', handler);
    }

    onError(handler: (error: Error) => void): void {
        this.ws.on('error', handler);
    }

    offOpen(handler: () => void): void {
        this.ws.off('open', handler);
    }

    offMessage(handler: (data: string) => void): void {
        const wrapper = this.messageWrappers.get(handler);
        if (wrapper) {
            this.ws.off('message', wrapper);
            this.messageWrappers.delete(handler);
        }
    }

    offClose(handler: () => void): void {
        this.ws.off('close', handler);
    }

    offError(handler: (error: Error) => void): void {
        this.ws.off('error', handler);
    }

    ping(): void {
        this.ws.ping();
    }

    onPong(handler: () => void): void {
        this.ws.on('pong', handler);
    }

    sendRaw(data: Uint8Array | string): void {
        this.ws.send(data);
    }

    onRawMessage(handler: (data: Uint8Array) => void): void {
        // node `ws` delivers every frame as a Buffer (a Uint8Array subclass).
        this.ws.on('message', (raw: Buffer) => handler(raw));
    }
}
