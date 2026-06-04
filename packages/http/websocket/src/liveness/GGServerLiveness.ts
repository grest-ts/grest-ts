import type {WebSocket, WebSocketServer} from "ws"

// Server-side WebSocket liveness: ping each client while the link is idle (keeping NAT/proxy/LB
// legs warm so an idle connection isn't silently dropped) and reap clients that stop answering
// (freeing whatever resource they held). Payload-agnostic — works for schema'd RPC sockets and
// raw byte streams alike, since liveness is a property of the transport, not the API.
export class GGServerLiveness {

    /** Ping each client this often when the link is idle; default 30s. */
    static readonly DEFAULT_INTERVAL_MS = 30_000

    /**
     * Protocol ping + reap over a `ws` WebSocketServer. Each tick: ping every client and terminate
     * any that didn't answer the previous ping's pong. The browser auto-answers protocol pings at
     * the protocol level — no client code involved. Sockets are tracked lazily off `wss.clients`,
     * so this works whether connections arrive via the normal upgrade path or `handleUpgrade` with
     * `noServer`. Returns a stop function.
     */
    static attach(wss: WebSocketServer, opts: {intervalMs?: number} = {}): () => void {
        const intervalMs = opts.intervalMs ?? GGServerLiveness.DEFAULT_INTERVAL_MS
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
}

type LiveServerSocket = WebSocket & {__ggAlive?: boolean}
