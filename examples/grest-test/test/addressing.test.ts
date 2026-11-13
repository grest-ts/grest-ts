import {callOn, GG_TEST_RUNNER, GGTest, GGTestContext, mockOf} from "@grest-ts/testkit"
import {GGHttpInterceptorsServer} from "@grest-ts/http/testkit"
import {SERVER_ERROR} from "@grest-ts/schema"
import {networkInterfaces} from "node:os"
import {AddressingHubRuntime} from "../src/AddressingHubRuntime"
import {AddressingRelayARuntime} from "../src/AddressingRelayARuntime"
import {AddressingRelayBRuntime} from "../src/AddressingRelayBRuntime"
import {AddressingHubApi, AddressingRelayApi, AddressingRelayInfoApi, AddressingThirdPartyApi, RelayTarget} from "../src/api/AddressingApi"
import {StoreClock} from "../src/services/targeting/StoreClock"

const failure = (action: PromiseLike<unknown>) => expect(Promise.resolve(action)).rejects

const fake = (host: string): RelayTarget => ({host, port: 4001, fingerprint256: "00".repeat(32), ca: undefined})

type StartMode = "startWorker" | "startInline" | "startIsolated"

const suite = (start: StartMode) => describe(`mocks and spies on client-addressed calls (${start})`, () => {
    const t = GGTest[start]({hub: AddressingHubRuntime, relayA: AddressingRelayARuntime, relayB: AddressingRelayBRuntime})
    const alice = new GGTestContext("Alice").apis({hub: AddressingHubApi})

    let relayA: RelayTarget
    let relayB: RelayTarget
    beforeAll(async () => {
        AddressingRelayInfoApi.routing.first()
        const first = await callOn(AddressingRelayInfoApi).target()
        AddressingRelayInfoApi.routing.last()
        const last = await callOn(AddressingRelayInfoApi).target()
        relayA = first.host === "127.0.0.2" ? first : last
        relayB = first.host === "127.0.0.2" ? last : first
        expect([relayA.host, relayB.host]).toEqual(["127.0.0.2", "127.0.0.3"])
    })

    describe("a fixed URL", () => {

        test("a mock answers a module-level client with a base path in its URL", async () => {
            await alice.hub.openPull({head: "fix"})
                .with(AddressingThirdPartyApi.mock.createPull.toMatchObject({head: "fix"}).andReturn({number: 7}))
                .toEqual("pull:7")
        })

        test("unmocked, the call is dialled for real, and a refused connection reaches the caller with its cause", async () => {
            await alice.hub.openPull({head: "fix"})
                .toEqual(expect.stringMatching(/^failed:SERVER_ERROR:.*ECONNREFUSED/))
        })

        test("a spy on an address needs no service running in the test, and fails with the dial error when nothing answers", async () => {
            await failure(
                alice.hub.openPull({head: "fix"})
                    .with(AddressingThirdPartyApi.spy.createPull.on(GGTest.target("127.0.0.7:4001")).toMatchObject({head: "fix"}))
            ).toThrow(/ROUTING_FAILED[^]*could not forward[^]*ECONNREFUSED/)
        })

        test("a mock on the address, and one on another address that isn't called", async () => {
            await alice.hub.openPull({head: "fix"})
                .with(
                    AddressingThirdPartyApi.mock.createPull.on(GGTest.target("http://127.0.0.7:4001")).andReturn({number: 8}),
                    AddressingThirdPartyApi.mock.createPull.on(GGTest.target("127.0.0.7:4002")).times(0).andReturn({number: 9}),
                )
                .toEqual("pull:8")
        })
    })

    describe("a pinned per-call target", () => {

        test("an untargeted mock answers before anything is dialled, whatever the address", async () => {
            await alice.hub.sync({targets: [fake("127.0.0.8")], branch: "main"})
                .with(AddressingRelayApi.mock.sync.toMatchObject({branch: "main"}).andReturn({branch: "main", by: "mock"}))
                .toEqual(["mock"])
        })

        test("unmocked, the call reaches the real runtime over TLS with its pin", async () => {
            await alice.hub.sync({targets: [relayA, relayB], branch: "main"})
                .toEqual(["real:127.0.0.2", "real:127.0.0.3"])
        })

        test("a wrong pin fails the call", async () => {
            await alice.hub.sync({targets: [{...relayA, fingerprint256: relayB.fingerprint256}], branch: "main"})
                .toEqual([expect.stringMatching(/^failed:SERVER_ERROR:.*fingerprint mismatch/)])
        })

        test("connection settings too big for a default-sized header still arrive", async () => {
            const ca = "-----BEGIN CERTIFICATE-----\n" + "A".repeat(64_000) + "\n-----END CERTIFICATE-----\n"
            await alice.hub.sync({targets: [{...relayA, ca}], branch: "main"})
                .toEqual(["real:127.0.0.2"])
        })

        test("a mock targeted at a runtime answers only calls sent to its address", async () => {
            await alice.hub.sync({targets: [relayA, relayB], branch: "main"})
                .with(AddressingRelayApi.mock.sync.on(t.relayA).andReturn({branch: "main", by: "mockA"}))
                .toEqual(["mockA", "real:127.0.0.3"])
        })

        test("a misrouted call misses the targeted mock, and the failure says where it went", async () => {
            await failure(
                alice.hub.sync({targets: [relayB], branch: "main"})
                    .with(AddressingRelayApi.mock.sync.on(t.relayA).andReturn({branch: "main", by: "mockA"}))
            ).toThrow(/sync on relayA\] Interceptor was never called![^]*went to: relayB \(1\)/)
        })

        test("a spy sees a real pinned call and its response", async () => {
            await alice.hub.sync({targets: [relayA], branch: "main"})
                .with(AddressingRelayApi.spy.sync.on(t.relayA).toMatchObject({branch: "main"}).responseToMatchObject({by: "real:127.0.0.2"}))
                .toEqual(["real:127.0.0.2"])
        })

        test("a spy on a runtime's address sees the same call", async () => {
            await alice.hub.sync({targets: [relayA], branch: "main"})
                .with(AddressingRelayApi.spy.sync.on(GGTest.target(`${relayA.host}:${relayA.port}`)).responseToMatchObject({by: "real:127.0.0.2"}))
                .toEqual(["real:127.0.0.2"])
        })

        test("fan-out: one mock per address, for targets no runtime listens at", async () => {
            await alice.hub.sync({targets: [fake("127.0.0.8"), fake("127.0.0.9")], branch: "main"})
                .with(
                    AddressingRelayApi.mock.sync.on(GGTest.target("127.0.0.8:4001")).andReturn({branch: "main", by: "mock8"}),
                    AddressingRelayApi.mock.sync.on(GGTest.target("127.0.0.9:4001")).andReturn({branch: "main", by: "mock9"}),
                )
                .toEqual(["mock8", "mock9"])
        })

        test("one target errors while a spy sees the other get the real call", async () => {
            await alice.hub.sync({targets: [relayA, relayB], branch: "main"})
                .with(
                    AddressingRelayApi.mock.sync.on(t.relayA).andReturn(new SERVER_ERROR({displayMessage: "down"})),
                    AddressingRelayApi.spy.sync.on(t.relayB).responseToMatchObject({by: "real:127.0.0.3"}),
                )
                .toEqual(["failed:SERVER_ERROR:down", "real:127.0.0.3"])
        })

        test("an address target no call is sent to says where the call went", async () => {
            await failure(
                alice.hub.sync({targets: [fake("127.0.0.9")], branch: "main"})
                    .with(AddressingRelayApi.mock.sync.on(GGTest.target("127.0.0.8:4001")).andReturn({branch: "main", by: "mock8"}))
            ).toThrow(/sync on 127\.0\.0\.8:4001\] Interceptor was never called![^]*went to: 127\.0\.0\.9:4001 \(1\)/)
        })
    })

    describe("which runtime an address belongs to", () => {
        // The hub's server is bound to all interfaces; pretend it listens on relay A's port too.
        let addresses: Map<string, {host: string, port: number}[]>
        let hubId: string
        let real: {host: string, port: number}[]
        beforeAll(() => {
            addresses = (GG_TEST_RUNNER.get().getExtensionInstance(GGHttpInterceptorsServer) as any).addresses
            hubId = t.hub.runtimes[0].runtimeId
            real = addresses.get(hubId)!
            addresses.set(hubId, [{host: "0.0.0.0", port: relayA.port}])
        })
        afterAll(() => {
            addresses.set(hubId, real)
        })

        test("a runtime bound to the host wins over one bound to all interfaces", async () => {
            await alice.hub.sync({targets: [relayA], branch: "main"})
                .with(
                    AddressingRelayApi.mock.sync.on(t.relayA).andReturn({branch: "main", by: "mockA"}),
                    AddressingRelayApi.mock.sync.on(t.hub).times(0).andReturn({branch: "main", by: "mockHub"}),
                )
                .toEqual(["mockA"])
        })

        test("a bind to all interfaces stands for loopback hosts", async () => {
            await alice.hub.sync({targets: [{...fake("127.0.0.8"), port: relayA.port}], branch: "main"})
                .with(AddressingRelayApi.mock.sync.on(t.hub).andReturn({branch: "main", by: "mockHub"}))
                .toEqual(["mockHub"])
        })

        test("a bind to all interfaces does not stand for other IPs", async () => {
            await alice.hub.sync({targets: [{...fake("10.255.255.1"), port: relayA.port}], branch: "main"})
                .with(
                    AddressingRelayApi.mock.sync.on(t.hub).times(0).andReturn({branch: "main", by: "mockHub"}),
                    AddressingRelayApi.mock.sync.andReturn({branch: "main", by: "mock"}),
                )
                .toEqual(["mock"])
        })
    })

    test("a runtime target and an address target for the same place fail the action", async () => {
        await failure(
            alice.hub.sync({targets: [relayA], branch: "main"}).with(
                AddressingRelayApi.mock.sync.on(t.relayA).atLeastOnce().andReturn({branch: "main", by: "mockA"}),
                AddressingRelayApi.mock.sync.on(GGTest.target(`${relayA.host}:${relayA.port}`)).atLeastOnce().andReturn({branch: "main", by: "mockA"}),
            )
        ).toThrow(/ROUTING_FAILED[^]*relayA[^]*both match/)
    })

    test("an untargeted spy on an API no runtime serves points to an address target", async () => {
        await failure(
            alice.hub.openPull({head: "fix"}).with(AddressingThirdPartyApi.spy.createPull)
        ).toThrow(/\.on\(GGTest\.target\(/)
    })

    test("the router carries a destination only for callers on this machine", async () => {
        const external = Object.values(networkInterfaces()).flat().find(address => address?.family === "IPv4" && !address.internal)?.address
        if (!external) return
        const port = GG_TEST_RUNNER.get().ipcServer.getPort()
        const destination = Buffer.from(JSON.stringify({url: "", settings: {host: relayA.host, port: relayA.port, tlsPin: {fingerprint256: relayA.fingerprint256}}})).toString("base64")
        const sync = (host: string) => fetch(`http://${host}:${port}/api/addressing-relay/sync`, {
            method: "POST",
            headers: {"content-type": "application/json", "x-gg-test-destination": destination},
            body: JSON.stringify({branch: "main"}),
        }).then(response => response.text())

        expect(await sync("127.0.0.1")).toContain("real:127.0.0.2")
        expect(await sync(external)).not.toContain("real:127.0.0.2")
    })

    test("a call with a relative base URL and no host is not sent to the router, so it fails as in production", async () => {
        await alice.hub.openPullAtRelativeUrl({head: "fix"})
            .with(AddressingThirdPartyApi.mock.createPull.times(0).andReturn({number: 7}))
            .toEqual(expect.stringMatching(/^failed:SERVER_ERROR/))
    })

    test("a call with no base URL and no host is not sent to the router, so it fails as in production", async () => {
        await alice.hub.syncWithoutTarget({branch: "main"})
            .with(AddressingRelayApi.mock.sync.times(0).andReturn({branch: "main", by: "mock"}))
            .toEqual(expect.stringMatching(/^failed:SERVER_ERROR/))
    })
})

suite("startWorker")
suite("startInline")
suite("startIsolated")

describe("GGTest.target", () => {
    GGTest.startWorker(AddressingHubRuntime)

    test("takes host:port, a bracketed IPv6 host, or a URL whose scheme gives the port", () => {
        expect(GGTest.target("Relay.Example:9600")).toMatchObject({host: "relay.example", port: 9600})
        expect(GGTest.target("[::1]:9600")).toMatchObject({host: "::1", port: 9600})
        expect(GGTest.target("https://api.github.com")).toMatchObject({host: "api.github.com", port: 443})
        expect(GGTest.target("http://api.github.com/base")).toMatchObject({host: "api.github.com", port: 80})
    })

    test("throws without a port", () => {
        expect(() => GGTest.target("relay.example")).toThrow(/expected "host:port"/)
    })

    test("throws on mockOf, where a method runs in a runtime, not at an address", async () => {
        await failure(
            callOn(AddressingHubApi).openPull({head: "fix"})
                .with(mockOf(StoreClock).stamp.on(GGTest.target("127.0.0.1:9")).andReturn("mocked"))
        ).toThrow(/takes a runtime here, not an address/)
    })
})
