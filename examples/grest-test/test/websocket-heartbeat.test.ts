/**
 * Heartbeat (PING/PONG liveness) on GGSocket — exercised directly over a pair of
 * in-memory adapters. The half-open case (a connection that dies WITHOUT a close
 * event) cannot be reproduced against a real healthy server, so this drops to the
 * adapter layer, the same way `auth-freshness-gate-ws.test.ts` does for handshake
 * timing. End-to-end client behaviour lives in `websocket-client.test.ts`.
 */

import {describe, it, expect} from "vitest"
import {GGSocket} from "@grest-ts/websocket"
import type {SocketAdapter} from "@grest-ts/websocket/internal"

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

/** A linked adapter that delivers frames to its peer. `dead` simulates a silent
 *  half-open link: frames are dropped and NO close event is ever delivered. */
class AppPair implements SocketAdapter {
    peer!: AppPair
    dead = false
    private msg: Array<(d: string) => void> = []
    private cls: Array<() => void> = []
    send(m: string): void { if (this.dead) return; const p = this.peer; queueMicrotask(() => { if (!p.dead) p.msg.forEach(h => h(m)) }) }
    close(): void { this.cls.forEach(h => h()) }
    onOpen(): void {} onMessage(h: (d: string) => void): void { this.msg.push(h) } onClose(h: () => void): void { this.cls.push(h) }
    onError(): void {} offOpen(): void {} offMessage(): void {} offClose(): void {} offError(): void {}
}

function linkedPair(): {client: GGSocket; server: GGSocket; a: AppPair; b: AppPair} {
    const a = new AppPair(), b = new AppPair()
    a.peer = b; b.peer = a
    return {client: new GGSocket(a), server: new GGSocket(b), a, b}
}

/** Adapter that supports protocol ping/pong; ping() auto-pongs like a real peer. */
class ProtocolAdapter implements SocketAdapter {
    pingCount = 0
    sent: string[] = []
    private pong: Array<() => void> = []
    answersPing = true
    send(m: string): void { this.sent.push(m) }
    close(): void {}
    onOpen(): void {} onMessage(): void {} onClose(): void {} onError(): void {}
    offOpen(): void {} offMessage(): void {} offClose(): void {} offError(): void {}
    ping(): void { this.pingCount++; if (this.answersPing) this.pong.forEach(h => h()) }
    onPong(h: () => void): void { this.pong.push(h) }
}

describe("GGSocket heartbeat", () => {

    it("app transport (no protocol ping): the peer auto-answers PING, so a live link stays open", async () => {
        const {client, server} = linkedPair()
        let closed = false
        client.onClose(() => { closed = true })

        client.startHeartbeat({intervalMs: 40, timeoutMs: 25})
        await wait(250)               // ~6 ping cycles against a responsive peer
        expect(closed).toBe(false)

        client.close(); server.close()
    })

    it("a silently half-open link is self-closed by the watchdog", async () => {
        const {client, server, b} = linkedPair()
        let closed = false
        client.onClose(() => { closed = true })

        client.startHeartbeat({intervalMs: 40, timeoutMs: 25})
        await wait(120)
        expect(closed).toBe(false)    // alive while the peer responds

        b.dead = true                 // server stops responding — no close event
        await wait(200)               // > intervalMs + timeoutMs
        expect(closed).toBe(true)

        client.close(); server.close()
    })

    it("uses protocol ping when the adapter supports it (no app PING frames)", async () => {
        const adapter = new ProtocolAdapter()
        const socket = new GGSocket(adapter)

        socket.startHeartbeat({intervalMs: 40, timeoutMs: 25})
        await wait(150)

        expect(adapter.pingCount).toBeGreaterThan(0)
        expect(adapter.sent.some(f => f.startsWith("p:"))).toBe(false)   // no app PING frame

        socket.close()
    })
})
