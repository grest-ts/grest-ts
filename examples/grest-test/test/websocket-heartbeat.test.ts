/**
 * Heartbeat (PING/PONG liveness) on GGSocket — exercised directly over a pair of
 * in-memory adapters. The half-open case (a connection that dies WITHOUT a close
 * event) cannot be reproduced against a real healthy server, so this drops to the
 * adapter layer, the same way `auth-freshness-gate-ws.test.ts` does for handshake
 * timing. End-to-end client behaviour lives in `websocket-client.test.ts`.
 */

import {describe, it, expect} from "vitest"
import {GGSocket, GGRawSocket} from "@grest-ts/websocket"
import {GGContext} from "@grest-ts/context"
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

/** Linked raw byte-stream adapter (no protocol ping — the browser case). `dead` simulates a
 *  silent half-open link: frames are dropped and NO close event is delivered. */
class RawPair implements SocketAdapter {
    peer!: RawPair
    dead = false
    private raw: Array<(d: Uint8Array, isBinary: boolean) => void> = []
    private cls: Array<() => void> = []
    send(): void {}
    sendRaw(m: Uint8Array | string): void {
        if (this.dead) return
        const buf = typeof m === "string" ? Buffer.from(m) : m
        const p = this.peer
        queueMicrotask(() => { if (!p.dead) p.raw.forEach(h => h(buf, false)) })
    }
    close(): void { this.cls.forEach(h => h()) }
    onOpen(): void {} onMessage(): void {} onClose(h: () => void): void { this.cls.push(h) } onError(): void {}
    offOpen(): void {} offMessage(): void {} offClose(): void {} offError(): void {}
    onRawMessage(h: (d: Uint8Array, isBinary: boolean) => void): void { this.raw.push(h) }
}

function rawLinkedPair(): {client: GGRawSocket; server: GGRawSocket; a: RawPair; b: RawPair} {
    const a = new RawPair(), b = new RawPair()
    a.peer = b; b.peer = a
    const ctx = new GGContext("raw-heartbeat-test")
    const client = new GGRawSocket(a, {apiName: "Test", socketPath: "/ws/test", connectionContext: ctx})
    const server = new GGRawSocket(b, {apiName: "Test", socketPath: "/ws/test", connectionContext: ctx})
    return {client, server, a, b}
}

describe("GGRawSocket heartbeat (framework keepalive for byte streams)", () => {

    it("a live link stays open: the peer auto-pongs the framework keepalive ping, no app code", async () => {
        const {client, server} = rawLinkedPair()
        let closed = false
        client.onClose(() => { closed = true })

        client.startHeartbeat({intervalMs: 40, timeoutMs: 25})
        await wait(250)               // ~6 ping cycles; server GGRawSocket auto-pongs each
        expect(closed).toBe(false)

        client.close(); server.close()
    })

    it("a silently half-open link is self-closed by the watchdog", async () => {
        const {client, server, b} = rawLinkedPair()
        let closed = false
        client.onClose(() => { closed = true })

        client.startHeartbeat({intervalMs: 40, timeoutMs: 25})
        await wait(120)
        expect(closed).toBe(false)    // alive while the peer auto-pongs

        b.dead = true                 // server stops answering — no close event
        await wait(200)               // > intervalMs + timeoutMs with no inbound frame
        expect(closed).toBe(true)

        client.close(); server.close()
    })

    it("keepalive frames are absorbed by the framework — never delivered to app handlers", async () => {
        const {client, server} = rawLinkedPair()
        const clientSeen: string[] = []; const serverSeen: string[] = []
        client.onMessage((d) => clientSeen.push(d.toString()))
        server.onMessage((d) => serverSeen.push(d.toString()))

        client.startHeartbeat({intervalMs: 40, timeoutMs: 25})
        await wait(150)               // several ping/pong round-trips

        expect(serverSeen).toEqual([]) // PING auto-ponged, never surfaced to the server app
        expect(clientSeen).toEqual([]) // PONG swallowed, never surfaced to the client app

        client.close(); server.close()
    })
})
