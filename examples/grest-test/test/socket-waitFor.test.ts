import {callOn, GGTest} from "@grest-ts/testkit"
import {MainRuntime} from "../src/main"
import {BroadcastSocketApi} from "../src/api/BroadcastSocketApi"
import "@grest-ts/websocket/testkit"

// The seed's delay makes onSnapshot arrive well after the requestSnapshot action has finished.
describe("waitFor on socket messages", () => {

    GGTest.startWorker(MainRuntime)

    const socket = callOn(BroadcastSocketApi)
    beforeAll(() => socket.connect())
    afterAll(() => socket.disconnect())

    test("catches a message that arrives after the action ends", async () => {
        await socket.requestSnapshot({delayMs: 300})
            .waitFor(socket.mock.onSnapshot.toMatchObject({values: []}))
    })

    test(".within(ms) bounds the wait and the error says nothing arrived", async () => {
        const start = Date.now()
        await expect(socket.requestSnapshot({delayMs: 1_000})
            .waitFor(socket.mock.onSnapshot.toMatchObject({values: []}).within(200))
        ).rejects.toThrow(/Not satisfied within 200ms[\s\S]*Interceptor was never called/)
        expect(Date.now() - start).toBeLessThan(900)
        await new Promise(resolve => setTimeout(resolve, 1_000))
    })

    test("a message that doesn't match fails at once with what arrived", async () => {
        const start = Date.now()
        await expect(socket.requestSnapshot({delayMs: 100})
            .waitFor(socket.mock.onSnapshot.toMatchObject({values: [999]}))
        ).rejects.toThrow(/MOCK_VALIDATION_FAILED/)
        expect(Date.now() - start).toBeLessThan(2_000)
    })
})
