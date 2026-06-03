// Temporary diagnostic logging for the outbound credential-freshness gate. On by default so a
// release captures the trace with no config; disable with globalThis.__GG_AUTH_DEBUG__ = false.
export function ggAuthLog(...args: unknown[]): void {
    const g = globalThis as {__GG_AUTH_DEBUG__?: boolean}
    if (g.__GG_AUTH_DEBUG__ === false) return
    const t = typeof performance !== "undefined" ? Math.round(performance.now()) : 0
    console.info(`[gg-auth +${t}ms]`, ...args)
}
