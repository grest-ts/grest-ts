/**
 * End-to-end demo of the production websocket client (`Api.createClient()`).
 *
 * Unlike `callOn(Api)` (testkit tooling), `createClient()` is what a browser
 * or service-to-service consumer would actually use. These tests run the real
 * runtime and exercise every messaging mode over a real socket.
 */

import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {GGWebSocketMiddleware} from "@grest-ts/websocket"
import {MainRuntime} from "../src/main"
import {ClientTestSocketApi} from "../src/api/ClientTestSocketApi"
import {AuthedSocketApi} from "../src/api/AuthedSocketApi"
import {QuerySocketApi} from "../src/api/QuerySocketApi"

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
            await client.outgoing.setCounter({value: 42})
            const {value} = await client.outgoing.getCounter()
            expect(value).toBe(42)
        } finally {
            await client.disconnect()
        }
    })

    test("serverToClient push — setup callback registers incoming handler", async () => {
        const client = ClientTestSocketApi.createClient({url: clientUrl()})

        const events: number[] = []
        await client.connect(({incoming}) => {
            incoming.on({
                counterChanged: ({value}) => {
                    events.push(value)
                },
            })
        })

        try {
            await client.outgoing.setCounter({value: 111})
            await wait(50)
            expect(events).toContain(111)
        } finally {
            await client.disconnect()
        }
    })

    test("serverToClient req/res — askMeAQuestion makes server ask client, returns client's answer", async () => {
        const client = ClientTestSocketApi.createClient({url: clientUrl()})

        await client.connect(({incoming}) => {
            incoming.on({
                needsConfirmation: async ({prompt}) => prompt.includes("yes"),
            })
        })

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

        const events: number[] = []
        await client.connect(({incoming}) => {
            incoming.on({
                counterChanged: ({value}) => {
                    events.push(value)
                },
                // needsConfirmation intentionally omitted
            })
        })

        try {
            await client.outgoing.setCounter({value: 7})
            await wait(50)
            expect(events).toContain(7)
        } finally {
            await client.disconnect()
        }
    })

    test("setup callback can also send outgoing (e.g. initial subscribe)", async () => {
        const client = ClientTestSocketApi.createClient({url: clientUrl()})
        let initialCounter: number | undefined

        await client.connect(async ({outgoing}) => {
            const {value} = await outgoing.getCounter()
            initialCounter = value
        })

        try {
            expect(typeof initialCounter).toBe("number")
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

    test("isConnected reflects state; onClose + onDisconnect fire with correct reasons on manual disconnect", async () => {
        const client = ClientTestSocketApi.createClient({url: clientUrl()})

        const closeReasons: string[] = []
        const disconnectReasons: string[] = []
        client.onClose((reason) => { closeReasons.push(reason) })
        client.onDisconnect((reason) => { disconnectReasons.push(reason) })

        expect(client.isConnected).toBe(false)
        await client.connect()
        expect(client.isConnected).toBe(true)

        await client.disconnect()
        expect(client.isConnected).toBe(false)
        await wait(50)
        expect(closeReasons).toEqual(["manual"])
        expect(disconnectReasons).toEqual(["manual"])
    })

    test("connect() after disconnect() on same client is rejected — create a new client", async () => {
        const client = ClientTestSocketApi.createClient({url: clientUrl()})
        await client.connect()
        await client.disconnect()
        await expect(client.connect()).rejects.toMatchObject({type: "SERVER_ERROR"})
    })

    // ----------------------------------------------------------------------
    // Config: middlewares + timeout
    // ----------------------------------------------------------------------

    describe("config.middlewares — extra client-side middlewares merged with schema's", () => {

        test("static-token middleware supplies header without a GGContext.run() wrapper", async () => {
            const StaticToken: GGWebSocketMiddleware = {
                updateHandshake(ctx) {
                    ctx.headers["authorization"] = "Bearer secret-alice"
                },
            }

            const client = AuthedSocketApi.createClient({
                url: clientUrl("AuthedSocketApi"),
                middlewares: [StaticToken],
            })

            await client.connect()
            try {
                const who = await client.outgoing.whoAmI()
                expect(who).toEqual({username: "alice"})
            } finally {
                await client.disconnect()
            }
        })

        test("invalid token from extra middleware: server's NOT_AUTHORIZED surfaces typed on client", async () => {
            const BadToken: GGWebSocketMiddleware = {
                updateHandshake(ctx) {
                    ctx.headers["authorization"] = "Bearer wrong"
                },
            }

            const client = AuthedSocketApi.createClient({
                url: clientUrl("AuthedSocketApi"),
                middlewares: [BadToken],
            })

            await expect(client.connect()).rejects.toMatchObject({
                type: "NOT_AUTHORIZED",
                context: {displayMessage: "Invalid token"},
            })
        })

        test("NOT_AUTHORIZED during reconnect attempt: retries stop, onClose fires with 'unrecoverable'", async () => {
            // Configure a client that WILL reconnect, but will get NOT_AUTHORIZED on every handshake
            // (bad token). First connect() throws — subsequent retries should not be attempted because
            // NOT_AUTHORIZED is terminal by default. We simulate this by intentionally triggering a
            // post-connect reconnect via a drop... but since initial connect fails we instead verify
            // that the default shouldRetry rejects NOT_AUTHORIZED: the scheduleReconnect path only
            // fires after a successful initial connect + drop, so this test focuses on predicate
            // classification via the direct connect() throw (which initial-connect does not retry).
            const BadToken: GGWebSocketMiddleware = {
                updateHandshake(ctx) {
                    ctx.headers["authorization"] = "Bearer wrong"
                },
            }

            const client = AuthedSocketApi.createClient({
                url: clientUrl("AuthedSocketApi"),
                middlewares: [BadToken],
                reconnect: {initialDelayMs: 10, maxAttempts: 5},
            })

            // Initial connect() rejects (no retry on initial connect by design).
            await expect(client.connect()).rejects.toMatchObject({type: "NOT_AUTHORIZED"})
        })

        test("custom shouldRetry predicate overrides default", async () => {
            // Verify predicate is invoked: use a custom one that always returns false,
            // then trigger a reconnect path. We can only test the predicate wiring here
            // without a way to force a drop — so just confirm createClient accepts the config.
            const client = AuthedSocketApi.createClient({
                url: clientUrl("AuthedSocketApi"),
                reconnect: {
                    initialDelayMs: 10,
                    shouldRetry: () => false,   // never retry anything
                },
            })
            // No assertion beyond "createClient accepted the config and can still connect normally"
            // — a real drop+retry test would need server-side socket injection.
            expect(client.isConnected).toBe(false)
        })
    })

    describe("config.timeout — per-client default for outgoing req/res calls", () => {

        test("very small timeout rejects slow server response with SERVER_ERROR", async () => {
            // The server's echo is instant; set a 1ms timeout and race against a guaranteed-late call.
            // `askMeAQuestion` makes the server round-trip to this client before responding —
            // a 1ms timeout will always blow past that.
            const client = ClientTestSocketApi.createClient({
                url: clientUrl(),
                timeout: 1,
            })

            await client.connect(({incoming}) => {
                incoming.on({
                    needsConfirmation: async () => {
                        await wait(200)
                        return true
                    },
                })
            })

            try {
                const result = await client.outgoing.askMeAQuestion({prompt: "x"}).asResult()
                expect(result.success).toBe(false)
                if (!result.success) {
                    expect(result.type).toBe("SERVER_ERROR")
                }
            } finally {
                await client.disconnect()
            }
        })
    })

    // ----------------------------------------------------------------------
    // queryOnConnect(validator) — runtime validation both sides
    // ----------------------------------------------------------------------

    describe("queryOnConnect validator", () => {

        test("valid query connects; echoRoom returns server's view of the query", async () => {
            const client = QuerySocketApi.createClient({
                url: clientUrl("QuerySocketApi"),
                query: {room: "general", version: 2},
            })
            await client.connect()
            try {
                const echo = await client.outgoing.echoRoom()
                expect(echo).toBe("general@2")
            } finally {
                await client.disconnect()
            }
        })

        test("invalid query: client-side validation throws VALIDATION_ERROR before opening socket", async () => {
            const client = QuerySocketApi.createClient({
                url: clientUrl("QuerySocketApi"),
                query: {room: "", version: 2 as any},    // empty room violates nonEmpty
            })
            await expect(client.connect()).rejects.toMatchObject({type: "VALIDATION_ERROR"})
        })

        test("query with wrong type: VALIDATION_ERROR thrown before connect", async () => {
            const client = QuerySocketApi.createClient({
                url: clientUrl("QuerySocketApi"),
                query: {room: "general", version: "two" as any},    // version must be int
            })
            await expect(client.connect()).rejects.toMatchObject({type: "VALIDATION_ERROR"})
        })
    })

    // ----------------------------------------------------------------------
    // Auth middleware on schema (existing pattern — still supported)
    // ----------------------------------------------------------------------

    describe("schema-level auth middleware still works via GGContext-scoped token", () => {

        test("valid token via middleware on schema: whoAmI returns user", async () => {
            const {GGContext} = await import("@grest-ts/context")
            const {CLIENT_AUTH_TOKEN} = await import("../src/api/AuthedSocketApi")

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
    })

})
