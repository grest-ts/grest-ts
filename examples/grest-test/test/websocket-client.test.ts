/**
 * End-to-end demo of the production websocket client (`Api.createClient()`).
 *
 * Unlike `callOn(Api)` which is testkit tooling, `createClient()` is what a
 * browser or service-to-service consumer would actually use. These tests run
 * the real runtime and exercise every messaging mode over a real socket.
 */

import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {GGContext} from "@grest-ts/context"
import {MainRuntime} from "../src/main"
import {ClientTestSocketApi} from "../src/api/ClientTestSocketApi"
import {AuthedSocketApi, CLIENT_AUTH_TOKEN} from "../src/api/AuthedSocketApi"

function clientUrl(apiName: string = "ClientTestSocketApi"): string {
    return GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl(apiName)
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe("WebSocket createClient (production client)", () => {

    GGTest.startWorker(MainRuntime)

    test("clientToServer req/res — await outgoing.echo() returns typed response", async () => {
        const client = ClientTestSocketApi.createClient({url: clientUrl()})
        await client.connect()
        try {
            const res = await client.outgoing.echo({message: "hello"})
            expect(res).toEqual({message: "hello", echoedBy: "server"})
        } finally {
            await client.disconnect()
        }
    })

    test("clientToServer fire-and-forget — setCounter arrives, verified via getCounter", async () => {
        const client = ClientTestSocketApi.createClient({url: clientUrl()})
        await client.connect()
        try {
            // Fire-and-forget: resolves as soon as the message is on the wire
            await client.outgoing.setCounter({value: 42})

            // Round-trip through a req/res call to confirm the server processed it
            const {value} = await client.outgoing.getCounter()
            expect(value).toBe(42)
        } finally {
            await client.disconnect()
        }
    })

    test("serverToClient push — incoming.on handler receives counterChanged", async () => {
        const client = ClientTestSocketApi.createClient({url: clientUrl()})

        const events: number[] = []
        client.incoming.on({
            counterChanged: ({value}) => {
                events.push(value)
            },
        })

        await client.connect()
        try {
            await client.outgoing.setCounter({value: 111})
            // Server broadcasts counterChanged to every connection synchronously,
            // but the push arrives on a separate frame — small wait avoids flakes.
            await wait(50)
            expect(events).toContain(111)
        } finally {
            await client.disconnect()
        }
    })

    test("serverToClient req/res — askMeAQuestion makes server ask client, returns client's answer", async () => {
        const client = ClientTestSocketApi.createClient({url: clientUrl()})

        client.incoming.on({
            needsConfirmation: async ({prompt}) => prompt.includes("yes"),
        })

        await client.connect()
        try {
            const yes = await client.outgoing.askMeAQuestion({prompt: "should we proceed? say yes"})
            expect(yes).toBe(true)

            const no = await client.outgoing.askMeAQuestion({prompt: "maybe not"})
            expect(no).toBe(false)
        } finally {
            await client.disconnect()
        }
    })

    test("Partial incoming.on — only register handlers you care about", async () => {
        const client = ClientTestSocketApi.createClient({url: clientUrl()})

        // Only subscribe to counterChanged, not needsConfirmation — and that's fine.
        const events: number[] = []
        client.incoming.on({
            counterChanged: ({value}) => {
                events.push(value)
            },
        })

        await client.connect()
        try {
            await client.outgoing.setCounter({value: 7})
            await wait(50)
            expect(events).toContain(7)
        } finally {
            await client.disconnect()
        }
    })

    test("handlers registered before connect are applied after handshake", async () => {
        const client = ClientTestSocketApi.createClient({url: clientUrl()})

        const events: number[] = []
        // Handler registered pre-connect
        client.incoming.on({
            counterChanged: ({value}) => {
                events.push(value)
            },
        })

        await client.connect()
        try {
            await client.outgoing.setCounter({value: 99})
            await wait(50)
            expect(events).toContain(99)
        } finally {
            await client.disconnect()
        }
    })

    test("outgoing before connect rejects with SERVER_ERROR", async () => {
        const client = ClientTestSocketApi.createClient({url: clientUrl()})
        const result = await client.outgoing.echo({message: "too early"}).asResult()
        expect(result.success).toBe(false)
        if (!result.success) {
            expect(result.type).toBe("SERVER_ERROR")
        }
    })

    test("onClose fires after disconnect; isConnected reflects state", async () => {
        const client = ClientTestSocketApi.createClient({url: clientUrl()})
        let closed = false
        client.onClose(() => {
            closed = true
        })

        expect(client.isConnected).toBe(false)
        await client.connect()
        expect(client.isConnected).toBe(true)

        await client.disconnect()
        expect(client.isConnected).toBe(false)
        // onClose is invoked asynchronously on socket close
        await wait(50)
        expect(closed).toBe(true)
    })

    // ----------------------------------------------------------------------
    // Auth middleware — schemas with `.use(Middleware)` work symmetrically:
    //   • client-side  updateHandshake(ctx) runs during connect() to add headers
    //   • server-side  parseHandshake(ctx) runs on the handshake message, can reject
    // Handshake rejection closes the socket with HANDSHAKE_ERR before any messages.
    // ----------------------------------------------------------------------

    describe("middleware — auth on handshake", () => {

        test("valid token: middleware adds header, server validates, whoAmI returns user", async () => {
            const client = AuthedSocketApi.createClient({url: clientUrl("AuthedSocketApi")})

            await new GGContext("test-auth-alice").run(async () => {
                CLIENT_AUTH_TOKEN.set("secret-alice")
                await client.connect()
                try {
                    const who = await client.outgoing.whoAmI()
                    expect(who).toEqual({username: "alice"})
                } finally {
                    await client.disconnect()
                }
            })
        })

        test("different token produces a different authed identity on the same API", async () => {
            const client = AuthedSocketApi.createClient({url: clientUrl("AuthedSocketApi")})

            await new GGContext("test-auth-bob").run(async () => {
                CLIENT_AUTH_TOKEN.set("secret-bob")
                await client.connect()
                try {
                    const who = await client.outgoing.whoAmI()
                    expect(who).toEqual({username: "bob"})
                } finally {
                    await client.disconnect()
                }
            })
        })

        test("missing token: server's NOT_AUTHORIZED surfaces on client", async () => {
            const client = AuthedSocketApi.createClient({url: clientUrl("AuthedSocketApi")})
            // No CLIENT_AUTH_TOKEN set → updateHandshake adds no header → server throws NOT_AUTHORIZED.
            await expect(client.connect()).rejects.toMatchObject({
                type: "NOT_AUTHORIZED",
                context: {displayMessage: "Missing bearer token"},
            })
        })

        test("invalid token: server's NOT_AUTHORIZED surfaces on client", async () => {
            const client = AuthedSocketApi.createClient({url: clientUrl("AuthedSocketApi")})

            await new GGContext("test-auth-invalid").run(async () => {
                CLIENT_AUTH_TOKEN.set("not-a-real-token")
                await expect(client.connect()).rejects.toMatchObject({
                    type: "NOT_AUTHORIZED",
                    context: {displayMessage: "Invalid token"},
                })
            })
        })
    })

})
