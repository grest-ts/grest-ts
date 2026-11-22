import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {RAW_ROUTE_PATH, RequestPeerRuntime} from "../src/RequestPeerRuntime"

type Seen = {peerAddress?: string, userAgent?: string, forwardedFor?: string}

async function whoAmI(headers: Record<string, string>): Promise<Seen> {
    const res = await fetch(`${GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("RequestPeer")}/api/request-peer/who-am-i`, {headers})
    return ((await res.json()) as {data: Seen}).data
}

describe("GG_HTTP_REQUEST connection facts", () => {
    GGTest.startInline(RequestPeerRuntime)

    test("a handler sees the peer address, the user agent and the raw X-Forwarded-For", async () => {
        const seen = await whoAmI({"user-agent": "probe/1.0", "x-forwarded-for": "203.0.113.7, 10.0.0.2"})
        expect(seen.peerAddress).toMatch(/127\.0\.0\.1|::1/)
        expect(seen.userAgent).toBe("probe/1.0")
        expect(seen.forwardedFor).toBe("203.0.113.7, 10.0.0.2")
    })

    test("without the headers, only the peer address", async () => {
        const seen = await whoAmI({"user-agent": ""})
        expect(seen.userAgent).toBeUndefined()
        expect(seen.forwardedFor).toBeUndefined()
        expect(seen.peerAddress).toMatch(/.+/)
    })
})

describe("a raw route's request context", () => {
    GGTest.startInline(RequestPeerRuntime)

    type RawSeen = {userAgent?: string, traceId?: string, marked: boolean}
    async function raw(): Promise<RawSeen> {
        const res = await fetch(`${GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl(`RequestPeer:${RAW_ROUTE_PATH}`)}${RAW_ROUTE_PATH}`, {headers: {"user-agent": "raw/1.0"}})
        return (await res.json()) as RawSeen
    }

    test("runs in its own context, with the request and a trace; what it sets doesn't reach the next request", async () => {
        const first = await raw()
        const second = await raw()
        expect(first).toMatchObject({userAgent: "raw/1.0", marked: false})
        expect(second.marked).toBe(false)
        expect(first.traceId).toBeDefined()
        expect(second.traceId).not.toBe(first.traceId)
    })
})
