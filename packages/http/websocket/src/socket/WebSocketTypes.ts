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
 * Includes all serverToClient methods plus onClose for lifecycle.
 */
export type WebSocketOutgoing<TServerToClient> = TServerToClient & {
    onClose(callback: () => void): void
}
