import {SocketAdapter} from "../socket/SocketAdapter";
import {DEFAULT_HEARTBEAT, type GGHeartbeatConfig, type GGSocketLogger, type GGSocketMetrics} from "../socket/GGSocket";
import {runHeartbeatLoop} from "./heartbeatLoop";

export interface SocketHeartbeatOpts {
    config: GGHeartbeatConfig;
    isActive: () => boolean;
    stampActivity: () => void;
    idleMs: () => number;
    apiName: string;
    socketPath: string;
    metrics?: GGSocketMetrics;
    log: GGSocketLogger;
    logSource: unknown;
    close: () => void;
    registerCleanup: (fn: () => void) => void;
    appPing?: () => void;
}

export function startSocketHeartbeat(adapter: SocketAdapter, opts: SocketHeartbeatOpts): () => void {
    if (!opts.isActive()) return () => {};

    const intervalMs = opts.config.intervalMs ?? DEFAULT_HEARTBEAT.intervalMs;
    const timeoutMs = opts.config.timeoutMs ?? DEFAULT_HEARTBEAT.timeoutMs;
    const useProtocol = !!(adapter.ping && adapter.onPong);

    // With no protocol ping (browser) and no app-level ping (a raw byte stream, where an
    // in-band PING would corrupt the opaque payload), we can't actively probe the link — a
    // watchdog would falsely reap an idle-but-healthy connection. Rely on inbound traffic and
    // the server-side heartbeat for liveness instead.
    if (!useProtocol && !opts.appPing) return () => {};

    opts.stampActivity();
    if (useProtocol) adapter.onPong!(() => opts.stampActivity());

    const sendPing = useProtocol
        ? () => { try { adapter.ping!(); } catch (_) {} }
        : () => { try { opts.appPing?.(); } catch (_) {} };

    const cleanup = runHeartbeatLoop({
        intervalMs,
        timeoutMs,
        isActive: opts.isActive,
        sendPing,
        idleMs: opts.idleMs,
        onTimeout: () => {
            opts.log.warn(opts.logSource, 'Heartbeat timeout - no response from peer; closing socket');
            opts.metrics?.recordHeartbeatTimeout({api: opts.apiName, path: opts.socketPath});
            opts.close();
        },
    });
    opts.registerCleanup(cleanup);

    return cleanup;
}
