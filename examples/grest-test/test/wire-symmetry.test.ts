/**
 * Wire-symmetry showcase: one AccountService, four wirings (header/cookie × HTTP/WS), all
 * reading the same ACCESS/LOCALE context keys. Each wiring returns the identical result
 * when the credential rides its matching channel, and a binding reads ONLY its own source.
 *
 * HTTP uses raw fetch and WS-cookie uses a raw upgrade so the test controls the exact wire
 * a browser would produce (the grest client can't attach cookies). WS-header uses the real
 * grest client to prove client-side header attach.
 */
import WebSocket from "ws"
import {GGContext} from "@grest-ts/context"
import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {MainRuntime} from "../src/main"
import {ACCESS, LOCALE} from "../src/api/wire-symmetry/Account"
import {AccountWsHeader} from "../src/api/wire-symmetry/wiring"

describe("wire symmetry — one service, four wirings", () => {

    GGTest.startWorker(MainRuntime)

    const httpBase = (): string => GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("WireAccountHttpHeader")
    const get = async (path: string, headers: Record<string, string>): Promise<any> => {
        const res = await fetch(`${httpBase()}${path}`, {headers})
        return res.json()
    }

    test("HTTP + header: bearer token and x-locale resolve the user and locale", async () => {
        const body = await get("/wire/h/whoami", {authorization: "Bearer tok-alice", "x-locale": "fr"})
        expect(body).toMatchObject({success: true, data: {user: "alice", locale: "fr"}})
    })

    test("HTTP + cookie: the SAME service resolves identically from cookies", async () => {
        const body = await get("/wire/c/whoami", {cookie: "access=tok-alice; locale=fr"})
        expect(body).toMatchObject({success: true, data: {user: "alice", locale: "fr"}})
    })

    test("LOCALE is a plain value — absent, it defaults to en; credential still required", async () => {
        const body = await get("/wire/h/whoami", {authorization: "Bearer tok-bob"})
        expect(body).toMatchObject({success: true, data: {user: "bob", locale: "en"}})
    })

    test("no credential → NOT_AUTHORIZED, regardless of wiring", async () => {
        expect(await get("/wire/h/whoami", {})).toMatchObject({success: false, type: "NOT_AUTHORIZED"})
        expect(await get("/wire/c/whoami", {})).toMatchObject({success: false, type: "NOT_AUTHORIZED"})
    })

    test("the cookie wiring ignores a header credential (strict single-source)", async () => {
        // Authorization is set, but the cookie wiring reads ONLY the cookie → unauthenticated.
        const body = await get("/wire/c/whoami", {authorization: "Bearer tok-alice"})
        expect(body).toMatchObject({success: false, type: "NOT_AUTHORIZED"})
    })

    test("the header wiring ignores a cookie credential (strict single-source)", async () => {
        const body = await get("/wire/h/whoami", {cookie: "access=tok-alice"})
        expect(body).toMatchObject({success: false, type: "NOT_AUTHORIZED"})
    })

    test("WS + header: in-band bearer (grest client) resolves the same service", async () => {
        const scope = new GGContext("wire-ws-h")
        scope.set(ACCESS, "tok-alice")
        scope.set(LOCALE, "de")
        await scope.run(async () => {
            const client = AccountWsHeader.createClient({url: GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("WireAccountWsHeader")})
            await client.connect()
            try {
                expect(await client.outgoing.whoami()).toMatchObject({user: "alice", locale: "de"})
            } finally {
                await client.disconnect()
            }
        })
    })

    test("WS + cookie: the real upgrade Cookie resolves the same service", async () => {
        const result = await whoamiOverRawWs("access=tok-carol; locale=es")
        expect(result).toMatchObject({success: true, data: {user: "carol", locale: "es"}})
    })
})

// Minimal raw-WS whoami over the cookie wiring: opens a socket with a real upgrade Cookie,
// drives the handshake + one request by hand (the grest client can't send cookies).
function whoamiOverRawWs(cookie: string): Promise<any> {
    const DELIM = ":"
    const wsUrl = GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("WireAccountWsCookie") + "/wire-ws/c"
    const frame = (type: string, path: string, id: string, data: unknown): string =>
        `${type}${DELIM}${path}${DELIM}${id}${DELIM}${data !== undefined ? JSON.stringify(data) : ""}`
    const parse = (raw: unknown): {type: string; id: string; data: any} => {
        const parts = String(raw).split(DELIM)
        const dataStr = parts.length > 3 ? parts.slice(3).join(DELIM) : undefined
        let data: any = undefined
        if (dataStr) { try { data = JSON.parse(dataStr) } catch { /* keep undefined */ } }
        return {type: parts[0], id: parts[2], data}
    }
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl, {headers: {cookie}})
        let settled = false
        ws.on("open", () => { ws.send(frame("h", "", "", {})) })
        ws.on("message", (raw: Buffer) => {
            const msg = parse(raw)
            if (msg.type === "k") {
                ws.send(frame("r", "WireAccountWsCookie.whoami", "1", undefined))
            } else if (msg.type === "x") {
                settled = true; ws.close(); reject(msg.data ?? {type: "UNKNOWN"})
            } else if (msg.type === "s") {
                settled = true; ws.close(); resolve(msg.data)
            }
        })
        ws.on("error", (err) => { if (!settled) { settled = true; reject(err) } })
        ws.on("close", () => { if (!settled) { settled = true; reject(new Error("socket closed before result")) } })
    })
}
