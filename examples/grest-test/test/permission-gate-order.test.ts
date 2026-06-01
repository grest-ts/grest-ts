/**
 * The permission gate must run BEFORE body/content validation, on every transport.
 * Both grest clients validate input before sending, so these use raw fetch / raw ws
 * to deliver an invalid payload from an under-scoped caller and assert the response
 * is FORBIDDEN (gate first), not VALIDATION_ERROR (would mean validation ran first).
 * The companion case — a properly-scoped caller with the same bad payload — must still
 * get VALIDATION_ERROR, proving validation still runs, just after the gate.
 */
import WebSocket from "ws"
import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {MainRuntime} from "../src/main"
import {AppPermission} from "../src/api/PermissionsApi"

describe("permission gate runs before body validation", () => {

    GGTest.startWorker(MainRuntime)

    describe("HTTP", () => {
        const url = (): string =>
            GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("PermissionsApi") + "/api/permissions/checks-inside"

        // checksInside requires anyOf(Admin, Owner) and an {label: string} body.
        const post = async (scopes: string, body: unknown) => {
            const res = await fetch(url(), {
                method: "POST",
                headers: {"Content-Type": "application/json", "x-test-scopes": scopes},
                body: JSON.stringify(body),
            })
            return await res.json() as {success: boolean; type?: string}
        }

        // Bad body: missing the required `label` — uncoercible, so it fails validation when reached.
        test("under-scoped caller + invalid body → FORBIDDEN (not VALIDATION_ERROR)", async () => {
            const body = await post(AppPermission.Read, {})
            expect(body).toMatchObject({success: false, type: "FORBIDDEN"})
        })

        test("scoped caller + invalid body → VALIDATION_ERROR (validation still runs, after the gate)", async () => {
            const body = await post(AppPermission.Admin, {})
            expect(body).toMatchObject({success: false, type: "VALIDATION_ERROR"})
        })
    })

    describe("WebSocket", () => {
        const DELIM = ":"
        const HANDSHAKE = "h", HANDSHAKE_OK = "k", HANDSHAKE_ERR = "x", REQ = "r", RES = "s"
        const frame = (type: string, path: string, id: string, data: unknown): string =>
            `${type}${DELIM}${path}${DELIM}${id}${DELIM}${data !== undefined ? JSON.stringify(data) : ""}`
        const parseFrame = (raw: unknown): {type: string; id: string; data: any} => {
            const parts = String(raw).split(DELIM)
            const dataStr = parts.length > 3 ? parts.slice(3).join(DELIM) : undefined
            let data: any = undefined
            if (dataStr) { try { data = JSON.parse(dataStr) } catch { /* keep undefined */ } }
            return {type: parts[0], id: parts[2], data}
        }

        const wsUrl = (): string =>
            GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("WsPermissionsApi") + "/ws/permissions-test"

        // Open a raw socket, authenticate via the in-band x-test-scopes header, and expose call().
        const openRaw = (scopes: string): Promise<{call(method: string, data: unknown): Promise<any>; close(): void}> =>
            new Promise((resolve, reject) => {
                const ws = new WebSocket(wsUrl())
                let nextId = 1
                let settled = false
                const pending = new Map<string, (data: any) => void>()
                ws.on("open", () => ws.send(frame(HANDSHAKE, "", "", {"x-test-scopes": scopes})))
                ws.on("message", (raw: Buffer) => {
                    const msg = parseFrame(raw)
                    if (msg.type === HANDSHAKE_OK) {
                        settled = true
                        resolve({
                            call: (method, data) => new Promise<any>((res2, rej2) => {
                                const id = String(nextId++)
                                const timer = setTimeout(() => { pending.delete(id); rej2(new Error(`ws ${method} timed out`)) }, 5000)
                                pending.set(id, (d) => { clearTimeout(timer); res2(d) })
                                ws.send(frame(REQ, `WsPermissionsApi.${method}`, id, data))
                            }),
                            close: () => ws.close(),
                        })
                    } else if (msg.type === HANDSHAKE_ERR) {
                        settled = true; ws.close(); reject(msg.data ?? {type: "UNKNOWN"})
                    } else if (msg.type === RES) {
                        const cb = pending.get(msg.id)
                        if (cb) { pending.delete(msg.id); cb(msg.data) }
                    }
                })
                ws.on("error", (err) => { if (!settled) { settled = true; reject(err) } })
                ws.on("close", () => { if (!settled) { settled = true; reject(new Error("closed before handshake")) } })
            })

        // needsRead requires Read and a string body. Bad body: an object — uncoercible to string.
        test("under-scoped caller + invalid body → FORBIDDEN (not VALIDATION_ERROR)", async () => {
            const conn = await openRaw(AppPermission.Admin)
            try {
                expect(await conn.call("needsRead", {x: 1})).toMatchObject({success: false, type: "FORBIDDEN"})
            } finally {
                conn.close()
            }
        })

        test("scoped caller + invalid body → VALIDATION_ERROR (validation still runs, after the gate)", async () => {
            const conn = await openRaw(AppPermission.Read)
            try {
                expect(await conn.call("needsRead", {x: 1})).toMatchObject({success: false, type: "VALIDATION_ERROR"})
            } finally {
                conn.close()
            }
        })
    })
})
