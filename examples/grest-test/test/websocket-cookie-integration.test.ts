/**
 * WebSocket httpOnly-cookie support.
 *
 * The integration suite opens a REAL socket with `ws` directly (not the grest
 * client, which deliberately can't send cookies on the upgrade — cookie auth is
 * browser-only) so it can put a `Cookie` on the upgrade GET exactly as a browser
 * does, then drives the in-band handshake by hand. Mirrors how the HTTP cookie
 * test uses raw `fetch`.
 */
import * as http from "http"
import WebSocket from "ws"
import {GGContext} from "@grest-ts/context"
import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {MainRuntime} from "../src/main"
import {SESSION} from "../src/api/CookieTestApi"

describe("ws cookie binding (unit)", () => {

    const inContext = (fn: () => void) => new GGContext("ws-cookie-unit").run(fn)

    test("parse reads the cookie from the upgrade Cookie header into the wire", () => {
        inContext(() => {
            SESSION.parse!({headers: {}, query: {}, cookie: "other=x; session=abc123; y=z"})
            expect(SESSION.get()).toBe("abc123")
        })
    })

    test("a cookie absent from inbound.cookie (in-band only) is never read (no spoof)", () => {
        inContext(() => {
            SESSION.parse!({headers: {cookie: "session=spoofed"}, query: {}})
            expect(SESSION.get()).toBeUndefined()
        })
    })

    test("no cookie → the wire stays undefined", () => {
        inContext(() => {
            SESSION.parse!({headers: {}, query: {}})
            expect(SESSION.get()).toBeUndefined()
        })
    })
})

describe("ws cookie integration (real upgrade)", () => {

    GGTest.startWorker(MainRuntime)

    const wsUrl = (): string =>
        GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("WsCookieApi") + "/ws/cookie-test"

    // Wire protocol (see @grest-ts/websocket "Message Protocol"): type:path:id:jsonData
    const DELIM = ":"
    const HANDSHAKE = "h", HANDSHAKE_OK = "k", HANDSHAKE_ERR = "x", REQ = "r", RES = "s"
    const frame = (type: string, path: string, id: string, data: unknown): string =>
        `${type}${DELIM}${path}${DELIM}${id}${DELIM}${data !== undefined ? JSON.stringify(data) : ""}`
    const parseFrame = (raw: unknown): {type: string; path: string; id: string; data: any} => {
        const parts = String(raw).split(DELIM)
        const dataStr = parts.length > 3 ? parts.slice(3).join(DELIM) : undefined
        let data: any = undefined
        if (dataStr) { try { data = JSON.parse(dataStr) } catch { /* keep undefined */ } }
        return {type: parts[0], path: parts[1], id: parts[2], data}
    }

    interface RawConn {
        call(method: string, data?: unknown): Promise<any>
        close(): void
        upgradeResponseHeaders: http.IncomingHttpHeaders
    }

    /**
     * Open a socket with an optional real Cookie on the upgrade, optionally smuggling
     * headers into the in-band handshake message. Resolves once HANDSHAKE_OK arrives;
     * rejects with the typed error payload on HANDSHAKE_ERR.
     */
    const openRaw = (cookie?: string, inBandHeaders: Record<string, string> = {}): Promise<RawConn> =>
        new Promise<RawConn>((resolve, reject) => {
            const ws = new WebSocket(wsUrl(), cookie ? {headers: {cookie}} : undefined)
            let upgradeResponseHeaders: http.IncomingHttpHeaders = {}
            let nextId = 1
            let settled = false
            const pending = new Map<string, (data: any) => void>()

            ws.on("upgrade", (res: http.IncomingMessage) => { upgradeResponseHeaders = res.headers })
            ws.on("open", () => { ws.send(frame(HANDSHAKE, "", "", inBandHeaders)) })
            ws.on("message", (raw: Buffer) => {
                const msg = parseFrame(raw)
                if (msg.type === HANDSHAKE_OK) {
                    settled = true
                    resolve({
                        call: (method, data) => new Promise<any>((res2, rej2) => {
                            const id = String(nextId++)
                            const timer = setTimeout(() => {
                                pending.delete(id)
                                rej2(new Error(`ws call ${method} timed out (no RES)`))
                            }, 5000)
                            pending.set(id, (d) => { clearTimeout(timer); res2(d) })
                            ws.send(frame(REQ, `WsCookieApi.${method}`, id, data))
                        }),
                        close: () => ws.close(),
                        upgradeResponseHeaders,
                    })
                } else if (msg.type === HANDSHAKE_ERR) {
                    settled = true
                    ws.close()
                    reject(msg.data ?? {type: "UNKNOWN"})
                } else if (msg.type === RES) {
                    const cb = pending.get(msg.id)
                    if (cb) { pending.delete(msg.id); cb(msg.data) }
                }
            })
            ws.on("error", (err) => { if (!settled) { settled = true; reject(err) } })
            ws.on("close", () => { if (!settled) { settled = true; reject(new Error("socket closed before handshake")) } })
        })

    test("connect with a session cookie succeeds; whoami echoes the cookie value", async () => {
        const conn = await openRaw("session=session-for-bob")
        try {
            expect(await conn.call("whoami")).toMatchObject({success: true, data: "session-for-bob"})
        } finally {
            conn.close()
        }
    })

    test("connecting WITHOUT a session cookie is rejected at the handshake (FORBIDDEN)", async () => {
        // SESSION is ambient (so the HTTP CookieTestApi can serve cookie-less requests),
        // and SESSION_SCOPES_WIRE derives no scopes from a missing cookie, so the
        // connectPermission(Read) gate fails the handshake with FORBIDDEN.
        await expect(openRaw()).rejects.toMatchObject({type: "FORBIDDEN"})
    })

    test("an admin session may call adminOnly; a plain session is FORBIDDEN", async () => {
        const admin = await openRaw("session=session-for-admin")
        try {
            expect(await admin.call("adminOnly")).toMatchObject({success: true, data: "admin-ok"})
        } finally {
            admin.close()
        }

        const plain = await openRaw("session=session-for-bob")
        try {
            expect(await plain.call("adminOnly")).toMatchObject({success: false, type: "FORBIDDEN"})
        } finally {
            plain.close()
        }
    })

    test("a cookie in the in-band handshake message cannot spoof identity", async () => {
        // No real upgrade Cookie; try to smuggle a session into the in-band handshake.
        // It must be ignored, so the connect gate still rejects (FORBIDDEN — no scopes).
        await expect(openRaw(undefined, {cookie: "session=session-for-admin"}))
            .rejects.toMatchObject({type: "FORBIDDEN"})
    })

    test("no Set-Cookie is emitted on the WS upgrade response", async () => {
        const conn = await openRaw("session=session-for-bob")
        try {
            // Guard against a vacuous pass: prove the 101 upgrade response was actually
            // captured (it always carries sec-websocket-accept etc.), THEN assert no Set-Cookie.
            expect(Object.keys(conn.upgradeResponseHeaders).length).toBeGreaterThan(0)
            expect(conn.upgradeResponseHeaders["set-cookie"]).toBeUndefined()
        } finally {
            conn.close()
        }
    })
})
