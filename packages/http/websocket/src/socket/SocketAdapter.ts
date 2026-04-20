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

    /**
     * Send a protocol-level PING frame. The peer auto-responds with a PONG.
     * Optional: browsers cannot initiate pings (the native WebSocket API does not expose it).
     * Node can; use this for dead-connection detection.
     */
    ping?(): void;

    /**
     * Register a handler for PONG frames received from the peer.
     * Paired with `ping()` — only supported by adapters that also support ping.
     */
    onPong?(handler: () => void): void;
}
