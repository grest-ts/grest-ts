/**
 * WebSocket connection pooling tests.
 *
 * By default, createClient() pools connections: same URL + same auth headers
 * → one physical socket shared across all clients. These tests verify:
 *
 *   - Two clients share one pool entry; their setup hooks both re-run on reconnect.
 *   - Disconnecting one client removes only its handlers; the other stays alive.
 *   - The last client disconnecting closes the shared socket (pool.size → 0).
 *   - Same contract + same URL + incoming.on → error (duplicate handler guard).
 *   - {dedicated: true} bypasses the pool, giving each client its own socket.
 */

import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {GGSocketPool} from "@grest-ts/websocket/internal"
import {GGLocatorScope} from "@grest-ts/locator"
import {MainRuntime} from "../src/main"
import {ClientTestSocketApi} from "../src/api/ClientTestSocketApi"

function clientUrl(): string {
    return GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("ClientTestSocketApi")
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe("WebSocket connection pooling", () => {

    GGTest.startWorker(MainRuntime)

    beforeEach(() => {
        GGSocketPool.__clearForTesting()
    })

    // -----------------------------------------------------------------------
    // Core pooling: two clients at the same URL share one entry
    // -----------------------------------------------------------------------

    test("two pooled clients at the same URL share one pool entry", async () => {
        const clientA = ClientTestSocketApi.createClient({url: clientUrl()})
        const clientB = ClientTestSocketApi.createClient({url: clientUrl()})

        await clientA.connect()
        expect(GGSocketPool.size).toBe(1)

        // Second client attaches to the same pool entry (no incoming.on = no conflict)
        await clientB.connect()
        expect(GGSocketPool.size).toBe(1)

        try {
            const resA = await clientA.outgoing.echo({message: "from-A"})
            const resB = await clientB.outgoing.echo({message: "from-B"})
            expect(resA).toEqual({message: "from-A", echoedBy: "server"})
            expect(resB).toEqual({message: "from-B", echoedBy: "server"})
        } finally {
            await clientA.disconnect()
            await clientB.disconnect()
        }
    })

    test("disconnecting one pooled client removes its handlers but keeps socket alive for the other", async () => {
        let setupRunsA = 0

        const clientA = ClientTestSocketApi.createClient({url: clientUrl()})
        const clientB = ClientTestSocketApi.createClient({url: clientUrl()})

        await clientA.connect(() => { setupRunsA++ })
        await clientB.connect()
        expect(GGSocketPool.size).toBe(1)

        // Disconnect A — pool entry survives because B is still attached
        await clientA.disconnect()
        expect(GGSocketPool.size).toBe(1)
        expect(clientA.isConnected).toBe(false)
        expect(clientB.isConnected).toBe(true)

        // B still works after A disconnected
        const res = await clientB.outgoing.echo({message: "still-alive"})
        expect(res.echoedBy).toBe("server")

        await clientB.disconnect()
        expect(GGSocketPool.size).toBe(0)

        // A's setup hook ran once (initial connect)
        expect(setupRunsA).toBe(1)
    })

    test("last client disconnect closes the shared socket (pool entry removed)", async () => {
        const clientA = ClientTestSocketApi.createClient({url: clientUrl()})

        await clientA.connect()
        expect(GGSocketPool.size).toBe(1)

        await clientA.disconnect()
        expect(GGSocketPool.size).toBe(0)
        expect(clientA.isConnected).toBe(false)
    })

    // -----------------------------------------------------------------------
    // Setup hooks: both clients' hooks re-run on reconnect
    // -----------------------------------------------------------------------

    test("forceReconnect on pooled entry re-runs both clients' setup hooks", async () => {
        let hooksA = 0
        let hooksB = 0

        const clientA = ClientTestSocketApi.createClient({url: clientUrl()})
        const clientB = ClientTestSocketApi.createClient({url: clientUrl()})

        await clientA.connect(() => { hooksA++ })
        await clientB.connect(() => { hooksB++ })

        expect(hooksA).toBe(1)
        expect(hooksB).toBe(1)

        // forceReconnect on either client triggers the shared entry's reconnect
        clientA.forceReconnect()

        // Wait for reconnect (pool entry uses default 500ms initial delay)
        for (let i = 0; i < 300 && (hooksA < 2 || hooksB < 2); i++) await wait(10)

        expect(hooksA).toBe(2)
        expect(hooksB).toBe(2)
        expect(clientA.isConnected).toBe(true)
        expect(clientB.isConnected).toBe(true)

        await clientA.disconnect()
        await clientB.disconnect()
    })

    // -----------------------------------------------------------------------
    // Lifecycle callbacks
    // -----------------------------------------------------------------------

    test("onClose and onDisconnect fire with 'manual' when a pooled client disconnects", async () => {
        const closeReasons: string[] = []
        const disconnectReasons: string[] = []

        const client = ClientTestSocketApi.createClient({url: clientUrl()})
        client.onClose((reason) => closeReasons.push(reason))
        client.onDisconnect((reason) => disconnectReasons.push(reason))

        await client.connect()
        expect(client.isConnected).toBe(true)

        await client.disconnect()
        expect(client.isConnected).toBe(false)

        await wait(20)
        expect(closeReasons).toEqual(["manual"])
        expect(disconnectReasons).toEqual(["manual"])
    })

    test("connect() after disconnect() on a pooled client throws SERVER_ERROR", async () => {
        const client = ClientTestSocketApi.createClient({url: clientUrl()})
        await client.connect()
        await client.disconnect()
        await expect(client.connect()).rejects.toMatchObject({type: "SERVER_ERROR"})
    })

    // -----------------------------------------------------------------------
    // Duplicate handler guard (Option B)
    // -----------------------------------------------------------------------

    test("same contract + same URL + incoming.on → throws on the second client", async () => {
        const clientA = ClientTestSocketApi.createClient({url: clientUrl()})
        const clientB = ClientTestSocketApi.createClient({url: clientUrl()})

        // A registers incoming handlers — occupies ClientTestSocketApi.counterChanged on the shared socket
        await clientA.connect(({incoming}) => {
            incoming.on({counterChanged: async () => {}})
        })

        // B tries to register the same handlers on the shared socket → conflict guard
        await expect(
            clientB.connect(({incoming}) => {
                incoming.on({counterChanged: async () => {}})
            })
        ).rejects.toThrow(/already registered/)

        await clientA.disconnect()
        await clientB.disconnect()
    })

    // -----------------------------------------------------------------------
    // Scope isolation: two GGLocatorScopes (two runtimes in same process)
    // must never share a pool bucket
    // -----------------------------------------------------------------------

    test("scope isolation — two GGLocatorScopes maintain separate pool buckets", async () => {
        const url = clientUrl()

        // Simulate two co-process runtimes, each with their own GGLocatorScope.
        const scopeA = new GGLocatorScope("RuntimeA-test")
        const scopeB = new GGLocatorScope("RuntimeB-test")

        const clientA = ClientTestSocketApi.createClient({url})
        const clientB = ClientTestSocketApi.createClient({url})

        // Each client's connect() runs inside its runtime's scope, so the pool
        // storage strategy routes to a different bucket per scope.
        await scopeA.run(() => clientA.connect())
        await scopeB.run(() => clientB.connect())

        // Each scope sees exactly its own 1 entry — not the other scope's.
        expect(scopeA.run(() => GGSocketPool.size)).toBe(1)
        expect(scopeB.run(() => GGSocketPool.size)).toBe(1)

        // Disconnect in scope A — scope B's pool is completely unaffected.
        await scopeA.run(() => clientA.disconnect())
        expect(scopeA.run(() => GGSocketPool.size)).toBe(0)
        expect(scopeB.run(() => GGSocketPool.size)).toBe(1)

        await scopeB.run(() => clientB.disconnect())
        expect(scopeB.run(() => GGSocketPool.size)).toBe(0)
    })

    test("scope teardown closes all pooled connections for that scope", async () => {
        const url = clientUrl()
        const scope = new GGLocatorScope("RuntimeTeardown-test")

        const client = ClientTestSocketApi.createClient({url})
        await scope.run(() => client.connect())
        expect(scope.run(() => GGSocketPool.size)).toBe(1)

        // runTeardowns() simulates what GGRuntime.teardown() does at shutdown.
        await scope.run(() => scope.runTeardowns())
        expect(scope.run(() => GGSocketPool.size)).toBe(0)
    })

    // -----------------------------------------------------------------------
    // Opt-out: dedicated: true gives each client its own socket
    // -----------------------------------------------------------------------

    test("{dedicated: true} bypasses the pool — each client opens its own socket", async () => {
        const clientA = ClientTestSocketApi.createClient({url: clientUrl(), dedicated: true})
        const clientB = ClientTestSocketApi.createClient({url: clientUrl(), dedicated: true})

        await clientA.connect(({incoming}) => {
            incoming.on({counterChanged: async () => {}})
        })
        await clientB.connect(({incoming}) => {
            // Same handler as A — no conflict because each has a dedicated socket
            incoming.on({counterChanged: async () => {}})
        })

        // Pool has no entries (dedicated clients are not pooled)
        expect(GGSocketPool.size).toBe(0)

        // Both work independently
        const resA = await clientA.outgoing.echo({message: "A"})
        const resB = await clientB.outgoing.echo({message: "B"})
        expect(resA.message).toBe("A")
        expect(resB.message).toBe("B")

        // Disconnect A — B stays alive
        await clientA.disconnect()
        expect(clientA.isConnected).toBe(false)
        expect(clientB.isConnected).toBe(true)

        await clientB.disconnect()
    })

})
