/**
 * The sender + watchdog pair behind a per-socket heartbeat: ping while the link is
 * idle, and fire `onTimeout` if no proof-of-life arrives within `intervalMs + timeoutMs`.
 * Transport- and payload-agnostic — schema sockets (GGSocket) and raw byte streams
 * (GGRawSocket) share this loop so the dead-connection semantics can't drift apart.
 */
export interface HeartbeatLoopConfig {
    intervalMs: number;
    timeoutMs: number;
    isActive: () => boolean;
    sendPing: () => void;
    /** Milliseconds since the last inbound frame (pong or real traffic). */
    idleMs: () => number;
    onTimeout: () => void;
}

export function runHeartbeatLoop(config: HeartbeatLoopConfig): () => void {
    const {intervalMs, timeoutMs, isActive, sendPing, idleMs, onTimeout} = config;

    const sender = setInterval(() => {
        if (isActive()) sendPing();
    }, intervalMs);

    const watchdog = setInterval(() => {
        if (!isActive()) return;
        if (idleMs() > intervalMs + timeoutMs) {
            cleanup();
            onTimeout();
        }
    }, timeoutMs);

    const cleanup = () => {
        clearInterval(sender);
        clearInterval(watchdog);
    };

    return cleanup;
}
