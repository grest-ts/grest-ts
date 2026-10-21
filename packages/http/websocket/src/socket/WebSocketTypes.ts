/**
 * Type helpers for WebSocket connection handlers
 */

/**
 * Incoming handler for clientToServer messages.
 * Call .on() with handlers for each method.
 */
export type WebSocketIncoming<TClientToServer> = {
    on(handlers: TClientToServer): void
}

/**
 * Outgoing interface for serverToClient messages.
 * Includes all serverToClient methods plus onClose/close for lifecycle, and bufferedAmount
 * (bytes queued but not yet sent) so a broadcaster can drop or close a slow consumer.
 */
export type WebSocketOutgoing<TServerToClient> = TServerToClient & {
    onClose(callback: () => void): void
    close(): void
    readonly bufferedAmount: number
}
