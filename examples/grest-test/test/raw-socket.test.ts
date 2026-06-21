/**
 * Raw byte-stream WebSocket sockets (webSocketSchema.bytes()).
 *
 * The critical guarantee under test: a raw socket runs the EXACT same handshake auth
 * as a schema socket. A real `ws` connection is opened by hand (like the cookie test),
 * the bearer token is smuggled through the in-band handshake, and only after
 * HANDSHAKE_OK does the connection stream raw bytes.
 */
import WebSocket from "ws"
import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {defineSocketContract, webSocketSchema} from "@grest-ts/websocket"
import {MainRuntime} from "../src/main"
import {RawEchoApi} from "../src/api/RawEchoApi"
import {AuthedSocketMiddleware, CLIENT_AUTH_TOKEN} from "../src/api/AuthedSocketApi"
import {WS_SESSION} from "../src/api/WsCookieApi"
import {GGContext} from "@grest-ts/context"
import {NOT_AUTHORIZED} from "@grest-ts/schema"

// Wire protocol control frames (see @grest-ts/websocket "Message Protocol"): type:path:id:jsonData
const DELIM = ":"
const HANDSHAKE = "h", HANDSHAKE_OK = "k", HANDSHAKE_ERR = "x", REQ = "r", RES = "s"
const frame = (type: string, path: string, id: string, data: unknown): string =>
    `${type}${DELIM}${path}${DELIM}${id}${DELIM}${data !== undefined ? JSON.stringify(data) : ""}`

describe("raw socket (webSocketSchema.bytes)", () => {

    GGTest.startWorker(MainRuntime)

    const rawUrl = (room?: string): string => {
        const base = GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("RawEchoApi") + "/ws/raw-echo"
        return room === undefined ? base : `${base}?room=${encodeURIComponent(room)}`
    }

    interface RawConn {
        send(data: string): void
        next(): Promise<string>
        close(): void
    }

    /**
     * Open a raw socket: send the handshake with an optional bearer token, resolve once
     * HANDSHAKE_OK arrives, then deliver every subsequent frame as raw bytes. Rejects with
     * the typed error payload on HANDSHAKE_ERR (auth failure).
     */
    const openRaw = (
        token: string | undefined,
        room: string | null = "room1",
        opts: {preHandshakeSend?: string} = {}
    ): Promise<RawConn> =>
        new Promise<RawConn>((resolve, reject) => {
            const ws = new WebSocket(rawUrl(room === null ? undefined : room))
            let open = false
            let settled = false
            const inbox: string[] = []
            let waiter: ((v: string) => void) | undefined

            const deliver = (s: string) => {
                if (waiter) { const w = waiter; waiter = undefined; w(s) }
                else inbox.push(s)
            }

            ws.on("open", () => {
                const headers = token ? {authorization: "Bearer " + token} : {}
                ws.send(frame(HANDSHAKE, "", "", headers))
                // Stream a frame BEFORE waiting for HANDSHAKE_OK — to prove it's dropped, not processed.
                if (opts.preHandshakeSend !== undefined) ws.send(opts.preHandshakeSend)
            })
            ws.on("message", (raw: Buffer) => {
                const text = raw.toString()
                if (!open) {
                    if (text.startsWith(HANDSHAKE_OK + DELIM)) {
                        open = true; settled = true
                        resolve({
                            send: (data) => ws.send(data),
                            next: () => new Promise<string>((res) => {
                                const buffered = inbox.shift()
                                if (buffered !== undefined) res(buffered)
                                else waiter = res
                            }),
                            close: () => ws.close(),
                        })
                    } else if (text.startsWith(HANDSHAKE_ERR + DELIM)) {
                        settled = true
                        ws.close()
                        const dataStr = text.split(DELIM).slice(3).join(DELIM)
                        reject(dataStr ? JSON.parse(dataStr) : {type: "UNKNOWN"})
                    }
                    return
                }
                deliver(text)
            })
            ws.on("error", (err) => { if (!settled) { settled = true; reject(err) } })
            ws.on("close", () => { if (!settled) { settled = true; reject(new Error("closed before handshake")) } })
        })

    test("authenticated connection streams bytes; echo carries the authed user + query", async () => {
        const conn = await openRaw("secret-alice", "lobby")
        try {
            conn.send("hello")
            expect(await conn.next()).toBe("alice@lobby:hello")
            conn.send("again")
            expect(await conn.next()).toBe("alice@lobby:again")
        } finally {
            conn.close()
        }
    })

    test("a different valid token authenticates as that user", async () => {
        const conn = await openRaw("secret-bob")
        try {
            conn.send("hi")
            expect(await conn.next()).toBe("bob@room1:hi")
        } finally {
            conn.close()
        }
    })

    test("missing bearer token is rejected at the handshake (NOT_AUTHORIZED) — no stream opens", async () => {
        await expect(openRaw(undefined)).rejects.toMatchObject({type: "NOT_AUTHORIZED"})
    })

    test("invalid bearer token is rejected at the handshake (NOT_AUTHORIZED)", async () => {
        await expect(openRaw("not-a-real-token")).rejects.toMatchObject({type: "NOT_AUTHORIZED"})
    })

    test("invalid query is rejected before the handshake even runs", async () => {
        // room is required; omitting it fails the queryOnConnect validator at connect.
        await expect(openRaw("secret-alice", null)).rejects.toBeDefined()
    })

    test("raw and schema sockets coexist on the same http server", async () => {
        // Raw byte stream...
        const raw = await openRaw("secret-alice", "shared")
        // ...and a typed schema socket (AuthedSocketApi) on the same server, by hand.
        const typedUrl = GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("AuthedSocketApi") + "/ws/authed-test"
        const typed = new WebSocket(typedUrl)
        const whoAmI = new Promise<any>((resolve, reject) => {
            typed.on("open", () => typed.send(frame(HANDSHAKE, "", "", {authorization: "Bearer secret-bob"})))
            typed.on("message", (buf: Buffer) => {
                const t = buf.toString()
                if (t.startsWith(HANDSHAKE_OK + DELIM)) {
                    typed.send(frame(REQ, "AuthedSocketApi.whoAmI", "1", undefined))
                } else if (t.startsWith(RES + DELIM)) {
                    resolve(JSON.parse(t.split(DELIM).slice(3).join(DELIM)))
                } else if (t.startsWith(HANDSHAKE_ERR + DELIM)) {
                    reject(new Error("typed handshake failed"))
                }
            })
            typed.on("error", reject)
        })
        try {
            raw.send("ping")
            expect(await raw.next()).toBe("alice@shared:ping")
            expect(await whoAmI).toMatchObject({success: true, data: {username: "bob"}})
        } finally {
            raw.close()
            typed.close()
        }
    })

    test("bytes streamed before HANDSHAKE_OK are dropped, not processed pre-auth", async () => {
        // Send "early" immediately after the handshake frame, before HANDSHAKE_OK arrives.
        // WebSocket preserves order, so if "early" had been delivered the server would echo it
        // FIRST. We assert the first echo is "late" — proving "early" hit the listener gap and
        // was dropped, never reaching the app.
        const conn = await openRaw("secret-alice", "room1", {preHandshakeSend: "early"})
        try {
            conn.send("late")
            expect(await conn.next()).toBe("alice@room1:late")
        } finally {
            conn.close()
        }
    })
})

describe("raw socket connectPermission gate (RawAdminApi)", () => {

    GGTest.startWorker(MainRuntime)

    const adminUrl = (): string =>
        GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("RawAdminApi") + "/ws/raw-admin"

    // Open with a real upgrade Cookie; resolve on HANDSHAKE_OK, reject the typed error on ERR.
    const openWithCookie = (cookie?: string): Promise<WebSocket> =>
        new Promise<WebSocket>((resolve, reject) => {
            const ws = new WebSocket(adminUrl(), cookie ? {headers: {cookie}} : undefined)
            let settled = false
            ws.on("open", () => ws.send(frame(HANDSHAKE, "", "", {})))
            ws.on("message", (buf: Buffer) => {
                const t = buf.toString()
                if (t.startsWith("k" + DELIM)) { settled = true; resolve(ws) }
                else if (t.startsWith("x" + DELIM)) {
                    settled = true; ws.close()
                    const d = t.split(DELIM).slice(3).join(DELIM)
                    reject(d ? JSON.parse(d) : {type: "UNKNOWN"})
                }
            })
            ws.on("error", (e) => { if (!settled) { settled = true; reject(e) } })
            ws.on("close", () => { if (!settled) { settled = true; reject(new Error("closed before handshake")) } })
        })

    test("an admin session passes the connect permission and the stream opens", async () => {
        const ws = await openWithCookie("session=session-for-admin")
        const echo = new Promise<string>((res) => ws.on("message", (b: Buffer) => res(b.toString())))
        try {
            ws.send("ping")
            expect(await echo).toBe("ping")
        } finally {
            ws.close()
        }
    })

    test("a non-admin session is rejected at the handshake (FORBIDDEN) — no stream", async () => {
        await expect(openWithCookie("session=session-for-bob")).rejects.toMatchObject({type: "FORBIDDEN"})
    })

    test("no session cookie is rejected (NOT_AUTHORIZED)", async () => {
        await expect(openWithCookie()).rejects.toMatchObject({type: "NOT_AUTHORIZED"})
    })
})

describe("createClient (real client, end-to-end)", () => {

    GGTest.startWorker(MainRuntime)

    const inTokenContext = <T>(token: string, fn: () => Promise<T>): Promise<T> =>
        new GGContext("raw-client-test").run(async () => {
            CLIENT_AUTH_TOKEN.set(token)
            return fn()
        })

    test("connects through the auth handshake and round-trips bytes", async () => {
        await inTokenContext("secret-alice", async () => {
            const client = RawEchoApi.createClient({
                url: GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("RawEchoApi"),
                query: {room: "lobby"},
                reconnect: false,
            })
            await client.connect()
            try {
                const got = new Promise<string>((res) =>
                    client.onMessage((data) => res(Buffer.from(data).toString())))
                client.send("hello")
                expect(await got).toBe("alice@lobby:hello")
            } finally {
                client.close()
            }
        })
    })

    test("a bad token rejects connect() with the typed handshake error", async () => {
        await inTokenContext("not-a-real-token", async () => {
            const client = RawEchoApi.createClient({
                url: GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("RawEchoApi"),
                query: {room: "lobby"},
                reconnect: false,
            })
            await expect(client.connect()).rejects.toBeInstanceOf(NOT_AUTHORIZED)
        })
    })
})

describe("passthrough auth guard", () => {

    // The danger passthrough introduces: a credential that's delivered via the grest-ts handshake
    // (a middleware with update(), e.g. GGHeader) can never arrive from a foreign client, so the
    // socket would open unauthenticated. Registration must fail loudly instead.
    test("rejects an update()-based (handshake-delivered) credential at build time", () => {
        expect(() => webSocketSchema(defineSocketContract("PassthroughBad", {passthrough: true}))
            .path("ws/pt-bad")
            .use(AuthedSocketMiddleware)   // has update() — the "fake header" path
            .done()
        ).toThrow(/passthrough/i)
    })

    test("a parse-only credential (cookie wire) does not trip the guard", () => {
        // WS_SESSION reads the upgrade cookie (parse-only, no update) — valid in passthrough.
        expect(() => webSocketSchema(defineSocketContract("PassthroughOk", {passthrough: true}))
            .path("ws/pt-ok")
            .use(WS_SESSION)
            .done()
        ).not.toThrow()
    })
})
