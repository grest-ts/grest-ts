import type {WebSocket, WebSocketServer} from "ws"

// Transport-level liveness for WebSockets: keep idle proxy/LB legs warm and detect a
// half-open link (NAT/proxy idle drop, laptop sleep) so it can be reaped (server) or
// reconnected (browser) instead of going silently dead until a manual refresh.
//
// This is deliberately payload-agnostic — it knows nothing about whether the socket
// carries schema'd RPC (GGSocket) or a raw byte stream (a terminal/PTY passthrough),
// because liveness is a property of the transport, not the API. The one thing it can't
// own is the in-band ping/pong wire format a browser needs (browsers can't initiate or
// observe protocol ping/pong frames) — that's the app's protocol, so the caller supplies
// `sendPing` / reports liveness via `isAlive`. See the package README for the raw-stream recipe.
export class GGSocketLiveness {

    /** Server pings each client this often when the link is idle; default 30s. */
    static readonly DEFAULT_SERVER_INTERVAL_MS = 30_000
    /** Browser sends an app-level ping this often; default 20s. */
    static readonly DEFAULT_BROWSER_PING_MS = 20_000
    /** Browser re-checks liveness on this cadence (plus on wake/online); default 10s. */
    static readonly DEFAULT_BROWSER_CHECK_MS = 10_000

    /**
     * Server-side protocol ping + reap over a `ws` WebSocketServer. Each tick: ping every
     * client (keeping intermediaries warm) and terminate any that didn't answer the previous
     * ping's pong (freeing whatever resource it held). The browser auto-answers protocol pings
     * at the protocol level — no client code involved. Sockets are tracked lazily off
     * `wss.clients`, so this works whether connections arrive via the normal upgrade path or
     * `handleUpgrade` with `noServer`. Returns a stop function.
     */
    static attachServer(wss: WebSocketServer, opts: {intervalMs?: number} = {}): () => void {
        const intervalMs = opts.intervalMs ?? GGSocketLiveness.DEFAULT_SERVER_INTERVAL_MS
        const timer = setInterval(() => {
            for (const ws of wss.clients) {
                const live = ws as LiveServerSocket
                if (live.__ggAlive === undefined) {
                    // First time we've seen this socket — start tracking it and give it a
                    // full interval of grace before the first liveness check.
                    live.__ggAlive = true
                    ws.on("pong", () => { (ws as LiveServerSocket).__ggAlive = true })
                    continue
                }
                if (live.__ggAlive === false) { ws.terminate(); continue }
                live.__ggAlive = false
                try { ws.ping() } catch { /* socket already closing */ }
            }
        }, intervalMs)
        return () => clearInterval(timer)
    }

    /**
     * Browser-side liveness watchdog. Sends an app-level ping on an interval and, while the
     * tab is visible, drops the socket (`onDead`) when the caller reports it stale via
     * `isAlive`. Re-checks immediately on `visibilitychange`/`online` so a slept-then-woken
     * tab self-heals the moment it's looked at again. The check is gated on tab visibility:
     * a backgrounded tab has its timers throttled, so a stale clock there is expected, not a
     * dead socket. Returns a teardown function.
     *
     * @param opts.isAlive Return `false` ONLY when the socket should be dropped and
     *   reconnected. Encode every app gate here (rx within timeout, socket open, peer
     *   actually speaks the keepalive protocol) — the watchdog acts purely on this verdict.
     * @param opts.onDead Drop the socket (e.g. `ws.close()`); the caller's reconnect loop
     *   takes over from there.
     */
    static attachBrowser(opts: {
        sendPing: () => void
        isAlive: () => boolean
        onDead: () => void
        pingMs?: number
        checkMs?: number
    }): () => void {
        const pingMs = opts.pingMs ?? GGSocketLiveness.DEFAULT_BROWSER_PING_MS
        const checkMs = opts.checkMs ?? GGSocketLiveness.DEFAULT_BROWSER_CHECK_MS
        const hasDoc = typeof document !== "undefined"
        const hasWin = typeof window !== "undefined"

        const check = () => {
            if (hasDoc && document.visibilityState !== "visible") return
            if (opts.isAlive()) return
            opts.onDead()
        }
        const pingTimer = setInterval(opts.sendPing, pingMs)
        const checkTimer = setInterval(check, checkMs)
        if (hasDoc) document.addEventListener("visibilitychange", check)
        if (hasWin) window.addEventListener("online", check)

        return () => {
            clearInterval(pingTimer)
            clearInterval(checkTimer)
            if (hasDoc) document.removeEventListener("visibilitychange", check)
            if (hasWin) window.removeEventListener("online", check)
        }
    }
}

type LiveServerSocket = WebSocket & {__ggAlive?: boolean}
