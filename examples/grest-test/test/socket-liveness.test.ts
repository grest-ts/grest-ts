/**
 * Unit coverage for the shared GGSocketLiveness primitives (server reap + browser
 * watchdog). These are payload-agnostic transport helpers, so they're exercised
 * against fakes rather than a real socket. The browser watchdog runs in the node
 * test env because it guards `document`/`window` — with neither present the
 * visibility gate is skipped and it acts purely on the `isAlive` verdict.
 */
import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"
import {GGSocketLiveness} from "@grest-ts/websocket"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

class FakeWs {
    pings = 0
    terminated = false
    private pongCbs: Array<() => void> = []
    on(event: string, cb: () => void): void { if (event === "pong") this.pongCbs.push(cb) }
    ping(): void { this.pings++ }
    terminate(): void { this.terminated = true }
    pong(): void { this.pongCbs.forEach(cb => cb()) }
}

function fakeWss(clients: Set<FakeWs>) {
    return {clients} as unknown as Parameters<typeof GGSocketLiveness.attachServer>[0]
}

describe("GGSocketLiveness.attachServer", () => {
    it("pings a responsive client every interval and never reaps it", () => {
        const ws = new FakeWs()
        const clients = new Set([ws])
        const stop = GGSocketLiveness.attachServer(fakeWss(clients), {intervalMs: 1000})

        vi.advanceTimersByTime(1000)        // first sight: track, grace tick, no ping yet
        expect(ws.pings).toBe(0)
        vi.advanceTimersByTime(1000)        // ping #1
        expect(ws.pings).toBe(1)
        ws.pong()                            // stays alive
        vi.advanceTimersByTime(1000)        // ping #2, still alive
        expect(ws.pings).toBe(2)
        expect(ws.terminated).toBe(false)
        stop()
    })

    it("terminates a client that misses its pong", () => {
        const ws = new FakeWs()
        const stop = GGSocketLiveness.attachServer(fakeWss(new Set([ws])), {intervalMs: 1000})

        vi.advanceTimersByTime(1000)        // track + grace
        vi.advanceTimersByTime(1000)        // ping #1, mark not-alive (no pong answered)
        expect(ws.pings).toBe(1)
        expect(ws.terminated).toBe(false)
        vi.advanceTimersByTime(1000)        // still no pong → reaped
        expect(ws.terminated).toBe(true)
        stop()
    })

    it("picks up a client that joins after start", () => {
        const clients = new Set<FakeWs>()
        const stop = GGSocketLiveness.attachServer(fakeWss(clients), {intervalMs: 1000})
        const late = new FakeWs()
        clients.add(late)

        vi.advanceTimersByTime(1000)        // first sight of `late`
        vi.advanceTimersByTime(1000)        // ping #1
        expect(late.pings).toBe(1)
        stop()
    })

    it("stop() halts the loop", () => {
        const ws = new FakeWs()
        const stop = GGSocketLiveness.attachServer(fakeWss(new Set([ws])), {intervalMs: 1000})
        vi.advanceTimersByTime(2000)
        stop()
        const before = ws.pings
        vi.advanceTimersByTime(5000)
        expect(ws.pings).toBe(before)
    })
})

describe("GGSocketLiveness.attachBrowser", () => {
    it("sends a ping every pingMs", () => {
        const sendPing = vi.fn()
        const stop = GGSocketLiveness.attachBrowser({
            sendPing, isAlive: () => true, onDead: () => {}, pingMs: 1000, checkMs: 500,
        })
        vi.advanceTimersByTime(3000)
        expect(sendPing).toHaveBeenCalledTimes(3)
        stop()
    })

    it("drops the socket once isAlive reports stale", () => {
        const onDead = vi.fn()
        let alive = true
        const stop = GGSocketLiveness.attachBrowser({
            sendPing: () => {}, isAlive: () => alive, onDead, pingMs: 1000, checkMs: 500,
        })
        vi.advanceTimersByTime(2000)
        expect(onDead).not.toHaveBeenCalled()
        alive = false
        vi.advanceTimersByTime(500)
        expect(onDead).toHaveBeenCalledTimes(1)
        stop()
    })

    it("stop() halts ping and check timers", () => {
        const sendPing = vi.fn()
        const onDead = vi.fn()
        const stop = GGSocketLiveness.attachBrowser({
            sendPing, isAlive: () => false, onDead, pingMs: 1000, checkMs: 500,
        })
        stop()
        vi.advanceTimersByTime(5000)
        expect(sendPing).not.toHaveBeenCalled()
        expect(onDead).not.toHaveBeenCalled()
    })
})
