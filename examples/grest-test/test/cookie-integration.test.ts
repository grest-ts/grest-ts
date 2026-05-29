/**
 * End-to-end cookie test over a real HTTP wire. Uses raw fetch (not the grest
 * client) so it observes Set-Cookie and resends Cookie exactly as a browser
 * would — the grest client intentionally hides response headers.
 */
import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {MainRuntime} from "../src/main"

function baseUrl(): string {
    return GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("CookieTestApi")
}

describe("cookie integration (real HTTP wire)", () => {

    GGTest.startWorker(MainRuntime)

    test("login emits a hardened Set-Cookie", async () => {
        const res = await fetch(`${baseUrl()}/cookie/login`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({user: "alice"}),
        })
        expect(res.status).toBe(200)
        const setCookie = res.headers.getSetCookie()
        await res.text()
        expect(setCookie).toHaveLength(1)
        expect(setCookie[0]).toMatch(/^sid=session-for-alice/)
        expect(setCookie[0]).toContain("HttpOnly")
        expect(setCookie[0]).toContain("Secure")
        expect(setCookie[0]).toContain("SameSite=Lax")
        expect(setCookie[0]).toContain("Max-Age=3600")
    })

    test("round-trip: the cookie from login is read back on the next request", async () => {
        const loginRes = await fetch(`${baseUrl()}/cookie/login`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({user: "bob"}),
        })
        const cookie = loginRes.headers.getSetCookie()[0].split(";")[0] // sid=session-for-bob
        await loginRes.text()

        const meRes = await fetch(`${baseUrl()}/cookie/me`, {headers: {cookie}})
        const body = await meRes.json()
        expect(body).toMatchObject({success: true, data: {session: "session-for-bob"}})
    })

    test("me without a cookie sees no session", async () => {
        const res = await fetch(`${baseUrl()}/cookie/me`)
        const body = await res.json()
        expect(body.success).toBe(true)
        expect(body.data?.session).toBeUndefined()
    })

    test("logout clears the cookie (Max-Age=0)", async () => {
        const loginRes = await fetch(`${baseUrl()}/cookie/login`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({user: "dave"}),
        })
        const cookie = loginRes.headers.getSetCookie()[0].split(";")[0]
        await loginRes.text()

        const res = await fetch(`${baseUrl()}/cookie/logout`, {
            method: "POST",
            headers: {"Content-Type": "application/json", cookie},
            body: "{}",
        })
        const setCookie = res.headers.getSetCookie()
        await res.text()
        expect(setCookie).toHaveLength(1)
        expect(setCookie[0]).toMatch(/^sid=;/)
        expect(setCookie[0]).toContain("Max-Age=0")
    })

    test("a read-only request (me, with cookie) does not re-emit Set-Cookie", async () => {
        const loginRes = await fetch(`${baseUrl()}/cookie/login`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({user: "carol"}),
        })
        const cookie = loginRes.headers.getSetCookie()[0].split(";")[0]
        await loginRes.text()
        const meRes = await fetch(`${baseUrl()}/cookie/me`, {headers: {cookie}})
        await meRes.json()
        expect(meRes.headers.getSetCookie()).toHaveLength(0)
    })
})
