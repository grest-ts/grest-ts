import {afterEach} from "vitest"
import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {sleep} from "@grest-ts/common"
import {MainRuntime} from "../src/main"
import {BroadcastSocketApi} from "../src/api/BroadcastSocketApi"

type Received = {snapshot: number[]} | {value: number}

describe("GGSocketBroadcast", () => {

    GGTest.startWorker(MainRuntime)

    const clients: ReturnType<typeof BroadcastSocketApi.createClient>[] = []
    afterEach(async () => {
        await Promise.all(clients.splice(0).map(client => client.disconnect()))
    })

    async function connect() {
        const received: Received[] = []
        const client = BroadcastSocketApi.createClient({url: GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("BroadcastSocketApi")})
        clients.push(client)
        await client.connect(({incoming}) => {
            incoming.on({
                onSnapshot: async ({values}) => { received.push({snapshot: values}) },
                onValue: async ({value}) => { received.push({value}) },
            })
        })
        return {client, received}
    }

    test("fans out to every joined connection, snapshot first", async () => {
        const a = await connect()
        const b = await connect()

        await a.client.outgoing.publish({value: 1})
        await a.client.outgoing.requestSnapshot({})
        await b.client.outgoing.requestSnapshot({})
        await vi.waitFor(() => expect([a.received.length, b.received.length]).toEqual([1, 1]))

        await a.client.outgoing.publish({value: 2})
        await vi.waitFor(() => expect([a.received.length, b.received.length]).toEqual([2, 2]))

        expect(a.received[0]).toEqual({snapshot: expect.arrayContaining([1])})
        expect(a.received[1]).toEqual({value: 2})
        expect(b.received[1]).toEqual({value: 2})
    })

    test("connections that never joined receive nothing", async () => {
        const member = await connect()
        const outsider = await connect()

        await member.client.outgoing.requestSnapshot({})
        await vi.waitFor(() => expect(member.received).toHaveLength(1))

        await outsider.client.outgoing.publish({value: 3})
        await vi.waitFor(() => expect(member.received).toHaveLength(2))
        await sleep(50)

        expect(outsider.received).toEqual([])
    })

    test("broadcasts during a slow seed are delivered after the snapshot, not lost", async () => {
        const slow = await connect()

        await slow.client.outgoing.requestSnapshot({delayMs: 200})
        await slow.client.outgoing.publish({value: 4})
        await vi.waitFor(() => expect(slow.received).toHaveLength(2))

        expect(slow.received[0]).toEqual({snapshot: expect.not.arrayContaining([4])})
        expect(slow.received[1]).toEqual({value: 4})
    })

    test("asking again on the same connection re-seeds it", async () => {
        const member = await connect()

        await member.client.outgoing.requestSnapshot({})
        await vi.waitFor(() => expect(member.received).toHaveLength(1))
        await member.client.outgoing.publish({value: 7})
        await member.client.outgoing.requestSnapshot({})
        await vi.waitFor(() => expect(member.received).toHaveLength(3))

        expect(member.received[1]).toEqual({value: 7})
        expect(member.received[2]).toEqual({snapshot: expect.arrayContaining([7])})
    })

    test("a newer seed supersedes one still running; the stale snapshot is dropped", async () => {
        const member = await connect()

        await member.client.outgoing.requestSnapshot({delayMs: 200})
        await member.client.outgoing.requestSnapshot({})
        await member.client.outgoing.publish({value: 8})
        await vi.waitFor(() => expect(member.received).toHaveLength(2))
        await sleep(300)

        expect(member.received).toEqual([{snapshot: expect.not.arrayContaining([8])}, {value: 8}])
    })

    test("a failing re-seed keeps a live member subscribed", async () => {
        const member = await connect()

        await member.client.outgoing.requestSnapshot({})
        await vi.waitFor(() => expect(member.received).toHaveLength(1))
        await member.client.outgoing.requestSnapshot({fail: true})
        await member.client.outgoing.publish({value: 9})
        await vi.waitFor(() => expect(member.received).toHaveLength(2))

        expect(member.received[1]).toEqual({value: 9})
    })

    test("a failing seed leaves the connection out", async () => {
        const failed = await connect()
        const member = await connect()

        await failed.client.outgoing.requestSnapshot({fail: true})
        await member.client.outgoing.requestSnapshot({})
        await vi.waitFor(() => expect(member.received).toHaveLength(1))

        await member.client.outgoing.publish({value: 5})
        await vi.waitFor(() => expect(member.received).toHaveLength(2))
        await sleep(50)

        expect(failed.received).toEqual([])
    })

    test("a closed connection doesn't disturb the rest", async () => {
        const leaving = await connect()
        const staying = await connect()

        await leaving.client.outgoing.requestSnapshot({})
        await staying.client.outgoing.requestSnapshot({})
        await vi.waitFor(() => expect([leaving.received.length, staying.received.length]).toEqual([1, 1]))

        await leaving.client.disconnect()
        await staying.client.outgoing.publish({value: 6})
        await vi.waitFor(() => expect(staying.received).toHaveLength(2))

        expect(staying.received[1]).toEqual({value: 6})
        expect(leaving.received).toHaveLength(1)
    })
})
