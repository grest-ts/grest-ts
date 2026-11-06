import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {RequestPeerRuntime} from "../src/RequestPeerRuntime"

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
