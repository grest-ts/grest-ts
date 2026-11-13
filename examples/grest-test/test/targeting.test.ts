import {GG_TEST_RUNNER, GGTest, GGTestContext, mockOf, spyOn} from "@grest-ts/testkit"
import {GGHttpInterceptorsServer} from "@grest-ts/http/testkit"
import {SERVER_ERROR} from "@grest-ts/schema"
import {TargetingGatewayRuntime} from "../src/TargetingGatewayRuntime"
import {TargetingStoreRuntime} from "../src/TargetingStoreRuntime"
import {STORE_REFUSED, TargetingGatewayApi, TargetingStoreApi} from "../src/api/TargetingApi"
import {StoreClock} from "../src/services/targeting/StoreClock"

const failure = (action: PromiseLike<unknown>) => expect(Promise.resolve(action)).rejects

type StartMode = "startWorker" | "startInline" | "startIsolated"

const schemaSuite = (start: StartMode) => describe(`targeting schema mocks and spies (${start})`, () => {
    const t = GGTest[start]({gateway: TargetingGatewayRuntime, storeA: TargetingStoreRuntime, storeB: TargetingStoreRuntime})
    const alice = new GGTestContext("Alice").apis({gateway: TargetingGatewayApi})

    afterEach(() => {
        TargetingStoreApi.routing.roundRobin()
    })

    test("each key of the start input selects its own runtime", () => {
        expect(t.gateway.runtimes).toHaveLength(1)
        expect(t.storeA.runtimes).toHaveLength(1)
        expect(t.storeB.runtimes).toHaveLength(1)
        expect(t.storeA.runtimes[0]).not.toBe(t.storeB.runtimes[0])
        expect(t.storeB.runtimes[0].label).toBe("storeB")
    })

    test("an untargeted mock answers wherever the call would go", async () => {
        await alice.gateway.save({text: "a", times: 2})
            .with(TargetingStoreApi.mock.save.times(2).toMatchObject({text: "a"}).andReturn({text: "a", by: "mock"}))
            .toEqual(["mock", "mock"])
    })

    test("an unmocked method of the same API still reaches the real service", async () => {
        await alice.gateway.saveAndStamp({text: "a"})
            .with(TargetingStoreApi.mock.save.andReturn({text: "a", by: "mock"}))
            .toEqual("mock|real")
    })

    test("a mock leaves the test's routing strategy alone", async () => {
        TargetingStoreApi.routing.first()
        await alice.gateway.save({text: "a", times: 1})
            .with(TargetingStoreApi.mock.save.andReturn({text: "a", by: "mock"}))
        const [one, two] = await alice.gateway.save({text: "a", times: 2})
            .with(
                TargetingStoreApi.mock.save.on(t.storeA).anyTimes().andReturn({text: "a", by: "storeA"}),
                TargetingStoreApi.mock.save.on(t.storeB).anyTimes().andReturn({text: "a", by: "storeB"}),
            )
        expect(one).toBe(two)
    })

    test("a targeted mock answers only the calls routed to its runtime", async () => {
        await alice.gateway.save({text: "a", times: 2})
            .with(TargetingStoreApi.mock.save.on(t.storeA).andReturn({text: "a", by: "mockA"}))
            .toEqual(expect.arrayContaining(["mockA", "real"]))
    })

    test("fan-out: one targeted mock per runtime, each called once", async () => {
        await alice.gateway.save({text: "a", times: 2})
            .with(
                TargetingStoreApi.mock.save.on(t.storeA).andReturn({text: "a", by: "mockA"}),
                TargetingStoreApi.mock.save.on(t.storeB).andReturn({text: "a", by: "mockB"}),
            )
            .toEqual(expect.arrayContaining(["mockA", "mockB"]))
    })

    test("one target fails while a spy sees the other get the real call", async () => {
        await alice.gateway.save({text: "a", times: 2})
            .with(
                TargetingStoreApi.mock.save.on(t.storeA).andReturn(new SERVER_ERROR()),
                TargetingStoreApi.spy.save.on(t.storeB).toMatchObject({text: "a"}).responseToMatchObject({by: "real"}),
            )
            .toEqual(expect.arrayContaining(["failed:SERVER_ERROR", "real"]))
    })

    test("a targeted interceptor wins over an untargeted one", async () => {
        await alice.gateway.save({text: "a", times: 2})
            .with(
                TargetingStoreApi.mock.save.on(t.storeA).andReturn({text: "a", by: "mockA"}),
                TargetingStoreApi.mock.save.andReturn({text: "a", by: "mockAny"}),
            )
            .toEqual(expect.arrayContaining(["mockA", "mockAny"]))
    })

    test("a misrouted call misses the targeted mock, and the failure says where it went", async () => {
        TargetingStoreApi.routing.first()
        const [first] = await alice.gateway.save({text: "a", times: 1})
            .with(
                TargetingStoreApi.mock.save.on(t.storeA).anyTimes().andReturn({text: "a", by: "storeA"}),
                TargetingStoreApi.mock.save.on(t.storeB).anyTimes().andReturn({text: "a", by: "storeB"}),
            )
        const other = first === "storeA" ? t.storeB : t.storeA
        await failure(
            alice.gateway.save({text: "a", times: 1})
                .with(TargetingStoreApi.mock.save.on(other).andReturn({text: "a", by: "mock"}))
        ).toThrow(new RegExp(`save on ${other.runtimes[0].label}\\] Interceptor was never called![^]*went to: ${first} \\(1\\)`))
    })

    test("a second interceptor for the same method and target throws", async () => {
        await failure(
            alice.gateway.save({text: "a", times: 1}).with(
                TargetingStoreApi.mock.save.andReturn({text: "a", by: "mock"}),
                TargetingStoreApi.spy.save,
            )
        ).toThrow(/already has an active mock or spy/)
        await failure(
            alice.gateway.save({text: "a", times: 1}).with(
                TargetingStoreApi.mock.save.on(t.storeA).andReturn({text: "a", by: "mock"}),
                TargetingStoreApi.mock.save.on(t.storeA).andReturn({text: "a", by: "mock"}),
            )
        ).toThrow(/save on storeA\] already has an active mock or spy/)
    })

    test("a spy can expect the real service's error", async () => {
        await alice.gateway.refuse()
            .with(TargetingStoreApi.spy.refuse.toBeError(STORE_REFUSED))
            .toEqual("refused:closed")
        await failure(
            alice.gateway.refuse().with(TargetingStoreApi.spy.refuse)
        ).toThrow(/Expected success 'OK', but got error 'STORE_REFUSED'/)
    })

    test("a spied call keeps its path parameters and query string", async () => {
        await alice.gateway.find({id: "7", tag: "x y"})
            .with(TargetingStoreApi.spy.find.responseToMatchObject("7:x y"))
            .toEqual("7:x y")
    })

    test("a mock callback can use the test's own clients", async () => {
        await alice.gateway.save({text: "from-callback", times: 1})
            .with(TargetingStoreApi.mock.save.andReturn(async ({text}: {text: string}) => {
                await alice.gateway.ack({text})
                return {text, by: "mock"}
            }))
            .toEqual(["mock"])
        await alice.gateway.acks().arrayToContainEqual("from-callback")
    })

    test("a call whose target is ambiguous fails the action with the reason", async () => {
        const addresses: Map<string, unknown> = (GG_TEST_RUNNER.get().getExtensionInstance(GGHttpInterceptorsServer) as any).addresses
        const storeB = t.storeB.runtimes[0].runtimeId
        const real = addresses.get(storeB)
        addresses.set(storeB, addresses.get(t.storeA.runtimes[0].runtimeId))
        try {
            await failure(
                alice.gateway.save({text: "a", times: 2})
                    .with(TargetingStoreApi.mock.save.on(t.storeA).anyTimes().andReturn({text: "a", by: "mock"}))
            ).toThrow(/ROUTING_FAILED[^]*served by several runtimes/)
        } finally {
            addresses.set(storeB, real)
        }
    })

    test(".on() takes exactly one runtime", () => {
        expect(() => TargetingStoreApi.mock.save.on(t as any)).toThrow(/takes a runtime selector/)
    })
})

schemaSuite("startWorker")
schemaSuite("startInline")
schemaSuite("startIsolated")

const replicaSuite = (start: StartMode) => describe(`targeting replicas with mockOf and spyOn (${start})`, () => {
    const t = GGTest[start]({gateway: TargetingGatewayRuntime, store: [TargetingStoreRuntime, TargetingStoreRuntime]})
    const alice = new GGTestContext("Alice").apis({gateway: TargetingGatewayApi})

    test("mockOf(...).on(replica) mocks the method in that replica only", async () => {
        await alice.gateway.stamp({times: 2})
            .with(mockOf(StoreClock).stamp.on(t.store[1]).andReturn("mocked"))
            .toEqual(expect.arrayContaining(["mocked", "real"]))
    })

    test("spyOn(...).on(replica) sees that replica's call only", async () => {
        await alice.gateway.stamp({times: 2})
            .with(
                spyOn(StoreClock).stamp.on(t.store[0]).responseToMatchObject("real"),
                mockOf(StoreClock).stamp.on(t.store[1]).andReturn("mocked"),
            )
            .toEqual(expect.arrayContaining(["mocked", "real"]))
    })

    test("a schema spy on one replica and a mockOf in the other", async () => {
        await alice.gateway.stamp({times: 2})
            .with(
                TargetingStoreApi.spy.stamp.on(t.store[0]),
                mockOf(StoreClock).stamp.on(t.store[1]).andReturn("mocked"),
            )
    })

    test("a mockOf callback can use the test's own clients", async () => {
        await alice.gateway.stamp({times: 2})
            .with(mockOf(StoreClock).stamp.times(2).andReturn(async () => {
                await alice.gateway.ack({text: "from-mockOf"})
                return "mocked"
            }))
            .toEqual(["mocked", "mocked"])
        await alice.gateway.acks().arrayToContainEqual("from-mockOf")
    })

    test("a second mockOf for the same method and target throws", async () => {
        await failure(
            alice.gateway.stamp({times: 1}).with(
                mockOf(StoreClock).stamp.andReturn("a"),
                mockOf(StoreClock).stamp.andReturn("b"),
            )
        ).toThrow(/StoreClock\.stamp\] already has an active mock or spy/)
    })

    test(".on() throws for a selector holding several runtimes", () => {
        expect(() => mockOf(StoreClock).stamp.on(t.store)).toThrow(/exactly one runtime, but this selector holds 2 \(store\[0\], store\[1\]\)/)
    })
})

replicaSuite("startWorker")
replicaSuite("startInline")
replicaSuite("startIsolated")

describe("stopping one of two replicas", () => {
    const t = GGTest.startWorker({gateway: TargetingGatewayRuntime, storeA: TargetingStoreRuntime, storeB: TargetingStoreRuntime})
    const alice = new GGTestContext("Alice").apis({gateway: TargetingGatewayApi})

    test("the other still serves and can be targeted", async () => {
        await t.storeA.stop()
        await alice.gateway.save({text: "a", times: 2})
            .with(TargetingStoreApi.spy.save.on(t.storeB).times(2))
            .toEqual(["real", "real"])
    })
})

describe("schema interceptors with no instance of the API", () => {
    GGTest.startWorker({gateway: TargetingGatewayRuntime})
    const alice = new GGTestContext("Alice").apis({gateway: TargetingGatewayApi})

    test("a mock answers", async () => {
        await alice.gateway.save({text: "a", times: 1})
            .with(TargetingStoreApi.mock.save.andReturn({text: "a", by: "mock"}))
            .toEqual(["mock"])
    })

    test("a spy says the service is not running", async () => {
        await failure(
            alice.gateway.save({text: "a", times: 1}).with(TargetingStoreApi.spy.save)
        ).toThrow(/Cannot add spy for 'TargetingStoreApi' - service is not running/)
    })

    test("an unmocked method of a mocked API fails at once", async () => {
        await alice.gateway.saveAndStamp({text: "a"})
            .with(TargetingStoreApi.mock.save.andReturn({text: "a", by: "mock"}))
            .toBeError(SERVER_ERROR)
    }, 5000)
})
