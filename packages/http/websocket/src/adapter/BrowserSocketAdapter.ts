import {SocketAdapter} from "../socket/SocketAdapter";

export class BrowserSocketAdapter implements SocketAdapter {
    private ws: globalThis.WebSocket;
    private messageWrappers = new WeakMap<(data: string) => void, (event: MessageEvent) => void>();
    private errorWrappers = new WeakMap<(error: Error) => void, (event: Event) => void>();

    constructor(url: string) {
        this.ws = new WebSocket(url);
    }

    send(message: string): void {
        this.ws.send(message);
    }

    close(): void {
        this.ws.close();
    }

    onOpen(handler: () => void): void {
        this.ws.addEventListener('open', handler);
    }

    onMessage(handler: (data: string) => void): void {
        const wrapper = (event: MessageEvent) => handler(event.data);
        this.messageWrappers.set(handler, wrapper);
        this.ws.addEventListener('message', wrapper);
    }

    onClose(handler: () => void): void {
        this.ws.addEventListener('close', handler);
    }

    onError(handler: (error: Error) => void): void {
        const wrapper = (event: Event) => handler(new Error('WebSocket error: ' + event.type));
        this.errorWrappers.set(handler, wrapper);
        this.ws.addEventListener('error', wrapper);
    }

    offOpen(handler: () => void): void {
        this.ws.removeEventListener('open', handler);
    }

    offMessage(handler: (data: string) => void): void {
        const wrapper = this.messageWrappers.get(handler);
        if (wrapper) {
            this.ws.removeEventListener('message', wrapper);
            this.messageWrappers.delete(handler);
        }
    }

    offClose(handler: () => void): void {
        this.ws.removeEventListener('close', handler);
    }

    offError(handler: (error: Error) => void): void {
        const wrapper = this.errorWrappers.get(handler);
        if (wrapper) {
            this.ws.removeEventListener('error', wrapper);
            this.errorWrappers.delete(handler);
        }
    }
}
