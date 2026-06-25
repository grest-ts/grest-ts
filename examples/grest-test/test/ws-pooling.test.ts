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
})
