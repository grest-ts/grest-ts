import {log} from "./wsLog"

/**
 * `check`: a socket may have died (the tab came back into view, the network came back, a frozen page
 * resumed, the clock jumped under a visible tab), so probe it. `reconnect`: the page was restored from
 * the back/forward cache, which closes its sockets.
 */
export type GGPageWake = "check" | "reconnect"

const CLOCK_TICK_MS = 10_000
const CLOCK_JUMP_MS = 30_000
// One wake often fires several events (visibilitychange + online + resume).
const DEBOUNCE_MS = 5_000

const listeners = new Set<(wake: GGPageWake) => void>()
const lastFired: Record<GGPageWake, number> = {check: -Infinity, reconnect: -Infinity}
let installed = false

/** Browser only; a no-op elsewhere. */
export function onPageWake(listener: (wake: GGPageWake) => void): () => void {
    if (typeof document === "undefined" || typeof window === "undefined") return () => {}
    install()
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

function fire(wake: GGPageWake): void {
    const now = Date.now()
    if (now - lastFired[wake] < DEBOUNCE_MS) return
    lastFired[wake] = now
    for (const listener of listeners) {
        try {
            listener(wake)
        } catch (err) {
            log.error("pageWake", `${wake} listener failed`, err)
        }
    }
}

function install(): void {
    if (installed) return
    installed = true

    // A hidden tab's timers are throttled to minutes, so the clock detector only runs while visible.
    let lastTick = Date.now()
    document.addEventListener("visibilitychange", () => {
        lastTick = Date.now()
        if (!document.hidden) fire("check")
    })
    window.addEventListener("pageshow", e => { if (e.persisted) fire("reconnect") })
    window.addEventListener("online", () => fire("check"))
    document.addEventListener("resume", () => fire("check"))
    // A machine that sleeps with the tab in front fires no event; its timers just stop.
    setInterval(() => {
        const now = Date.now()
        if (!document.hidden && now - lastTick >= CLOCK_TICK_MS + CLOCK_JUMP_MS) fire("check")
        lastTick = now
    }, CLOCK_TICK_MS)
}
