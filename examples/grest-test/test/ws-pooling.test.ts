/**
 * End-to-end proof of extendable (pooled) WebSocket schemas.
 *
 * `MessagingSocket` and `PresenceSocket` are two independent modules that each `extend` the same
 * `ChatSocket` ("ws/chat"). Before pooling, binding two schemas on one path threw. Here both are
 * registered on the one path and a real client for each exercises req/res + server-push through
 * the live runtime, proving the server multiplexes both contracts over the shared connection.
 */

import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {MainRuntime} from "../src/main"
import {MessagingSocket} from "../src/api/ChatMessagingApi"
import {PresenceSocket} from "../src/api/ChatPresenceApi"
import {GGSocketPool} from "@grest-ts/websocket/internal"
import {freezableProxy} from "./freezableProxy"

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Both extensions share one socket server, registered under the first-bound extension's name.
const chatUrl = () => GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("Messaging")

describe("WebSocket extendable schemas (pooled path)", () => {

    GGTest.startWorker(MainRuntime)

    test("two modules extend one connection and both work over the shared path", async () => {
        const messaging = MessagingSocket.createClient({url: chatUrl()})
        const presence = PresenceSocket.createClient({url: chatUrl()})

        const messages: string[] = []
        const statuses: string[] = []

        await messaging.connect(({incoming}) => {
            incoming.on({message: async ({text}) => { messages.push(text) }})
        })
        await presence.connect(({incoming}) => {
            incoming.on({presenceChanged: async ({status}) => { statuses.push(status) }})
        })

        try {
            // Messaging extension: req/res + a server push back on the same socket.
            const res = await messaging.outgoing.send({text: "hi"})
            expect(res).toEqual({echoed: "hi"})

            // Presence extension, registered on the same path, routes independently.
            await presence.outgoing.setStatus({status: "online"})

            await wait(50)
            expect(messages).toContain("echo:hi")
            expect(statuses).toContain("online")

            // The two contracts are isolated — neither leaks into the other's handlers.
            expect(statuses).not.toContain("echo:hi")
            expect(messages).not.toContain("online")
        } finally {
            await messaging.disconnect()
            await presence.disconnect()
        }
    })

    test("two extended clients share exactly one physical socket", async () => {
        GGSocketPool.__clearForTesting()

        const messaging = MessagingSocket.createClient({url: chatUrl()})
        const presence = PresenceSocket.createClient({url: chatUrl()})

        await messaging.connect(({incoming}) => {
            incoming.on({message: async () => {}})
        })
        await presence.connect(({incoming}) => {
            incoming.on({presenceChanged: async () => {}})
        })

        try {
            expect(GGSocketPool.size).toBe(1)
        } finally {
            await messaging.disconnect()
            await presence.disconnect()
        }

        // After both disconnect the pool is empty.
        expect(GGSocketPool.size).toBe(0)
    })
    test("a half-open shared socket: each client's probe finds it dead and they reconnect onto one fresh socket", async () => {
        GGSocketPool.__clearForTesting()
        const proxy = await freezableProxy(chatUrl())
        const messaging = MessagingSocket.createClient({url: proxy.url, reconnect: {initialDelayMs: 10}})
        const presence = PresenceSocket.createClient({url: proxy.url, reconnect: {initialDelayMs: 10}})
        let setups = 0
        await messaging.connect(({incoming}) => { setups++; incoming.on({message: async () => {}}) })
        await presence.connect(({incoming}) => { setups++; incoming.on({presenceChanged: async () => {}}) })

        try {
            proxy.freeze()
            messaging.forceReconnect()   // pooled: probes rather than dropping a socket others share
            presence.checkConnection()
            await vi.waitFor(() => expect(setups).toBe(4), {timeout: 5_000})
            expect(GGSocketPool.size).toBe(1)
            expect(await messaging.outgoing.send({text: "back"})).toEqual({echoed: "back"})
        } finally {
            await messaging.disconnect()
            await presence.disconnect()
            await proxy.close()
        }
        expect(GGSocketPool.size).toBe(0)
    }, 10_000)
})
