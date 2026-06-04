// Diagnostics for the auth refresh / freshness-gate flow. Every call site here is an
// ABNORMAL event — a failed background refresh, a cross-tab lock acquire timeout, a
// degraded fallback — that never happens on the healthy path, so it stays silent in
// normal operation. This is deliberately NOT per-request tracing (that was high-frequency
// and removed); it is warn-on-failure so a stuck/half-broken auth flow is visible in the
// console instead of only mutating session state. Set `GGAuthLog.enabled = false` to mute.
export class GGAuthLog {
    static enabled = true

    static warn(message: string, ...details: unknown[]): void {
        if (!GGAuthLog.enabled) return
        console.warn(`[gg-auth] ${message}`, ...details)
    }
}
