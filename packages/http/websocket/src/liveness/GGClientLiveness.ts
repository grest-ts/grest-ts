// Client-side WebSocket liveness: ping the peer on an interval and, while the tab is visible, drop
// the socket when the caller reports it stale so the app's reconnect loop self-heals a half-open
// link (NAT/proxy idle drop, laptop sleep). Payload-agnostic — the caller owns the in-band
// ping/pong wire format (browsers can't initiate or observe protocol ping/pong frames) and reports
// liveness, so this works for schema'd RPC sockets and raw byte streams alike.
export class GGClientLiveness {

    /** Send an app-level ping this often; default 20s. */
    static readonly DEFAULT_PING_MS = 20_000
    /** Re-check liveness on this cadence (plus on wake/online); default 10s. */
    static readonly DEFAULT_CHECK_MS = 10_000

    /**
     * Sends an app-level ping on an interval and, while the tab is visible, drops the socket
     * (`onDead`) when the caller reports it stale via `isAlive`. Re-checks immediately on
     * `visibilitychange`/`online` so a slept-then-woken tab self-heals the moment it's looked at
     * again. The check is gated on tab visibility: a backgrounded tab has its timers throttled, so
     * a stale clock there is expected, not a dead socket. Returns a teardown function.
     *
     * @param opts.isAlive Return `false` ONLY when the socket should be dropped and reconnected.
     *   Encode every app gate here (rx within timeout, socket open, peer actually speaks the
     *   keepalive protocol) — the watchdog acts purely on this verdict.
     * @param opts.onDead Drop the socket (e.g. `ws.close()`); the caller's reconnect loop takes
     *   over from there.
     */
    static attach(opts: {
        sendPing: () => void
        isAlive: () => boolean
        onDead: () => void
        pingMs?: number
        checkMs?: number
    }): () => void {
        const pingMs = opts.pingMs ?? GGClientLiveness.DEFAULT_PING_MS
        const checkMs = opts.checkMs ?? GGClientLiveness.DEFAULT_CHECK_MS
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
