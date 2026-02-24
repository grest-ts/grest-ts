export interface SocketAdapter {
    send(message: string): void;

    close(): void;

    onOpen(handler: () => void): void;

    onMessage(handler: (data: string) => void): void;

    onClose(handler: () => void): void;

    onError(handler: (error: Error) => void): void;

    offOpen(handler: () => void): void;

    offMessage(handler: (data: string) => void): void;

    offClose(handler: () => void): void;

    offError(handler: (error: Error) => void): void;
}
