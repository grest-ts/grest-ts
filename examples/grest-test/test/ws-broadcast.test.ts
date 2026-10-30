import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {MainRuntime} from "../src/main"
import {BroadcastSocketApi} from "../src/api/BroadcastSocketApi"

type Received = {snapshot: number[]} | {value: number}

async function connect() {
    const received: Received[] = []
    const client = BroadcastSocketApi.createClient({url: GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("BroadcastSocketApi")})
    await client.connect(({incoming}) => {
        incoming.on({
            onSnapshot: async ({values}) => { received.push({snapshot: values}) },
            onValue: async ({value}) => { received.push({value}) },
        })
    })
    return {client, received}
}

async function until(check: () => boolean): Promise<void> {
    for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 10))
    expect(check()).toBe(true)
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe("GGSocketBroadcast", () => {

    GGTest.startWorker(MainRuntime)

    test("fans out to every joined connection, snapshot first", async () => {
        const a = await connect()
        const b = await connect()
        try {
            await a.client.outgoing.publish({value: 1})
            await a.client.outgoing.requestSnapshot({})
            await b.client.outgoing.requestSnapshot({})
            await until(() => a.received.length === 1 && b.received.length === 1)

            await a.client.outgoing.publish({value: 2})
            await until(() => a.received.length === 2 && b.received.length === 2)

            expect(a.received[0]).toEqual({snapshot: expect.arrayContaining([1])})
            expect(a.received[1]).toEqual({value: 2})
            expect(b.received[1]).toEqual({value: 2})
        } finally {
            await a.client.disconnect()
            await b.client.disconnect()
        }
    })

    test("connections that never joined receive nothing", async () => {
        const member = await connect()
        const outsider = await connect()
        try {
            await member.client.outgoing.requestSnapshot({})
            await until(() => member.received.length === 1)

            await outsider.client.outgoing.publish({value: 3})
            await until(() => member.received.length === 2)
            await wait(50)

            expect(outsider.received).toEqual([])
        } finally {
            await member.client.disconnect()
            await outsider.client.disconnect()
        }
    })

    test("broadcasts during a slow seed are delivered after the snapshot, not lost", async () => {
        const slow = await connect()
        const publisher = await connect()
        try {
            await slow.client.outgoing.requestSnapshot({delayMs: 200})
            await wait(50)
            await publisher.client.outgoing.publish({value: 4})
            await until(() => slow.received.length === 2)

            expect(slow.received[0]).toEqual({snapshot: expect.not.arrayContaining([4])})
            expect(slow.received[1]).toEqual({value: 4})
        } finally {
            await slow.client.disconnect()
            await publisher.client.disconnect()
        }
    })

    test("a failing seed leaves the connection out", async () => {
        const failed = await connect()
        const member = await connect()
        try {
            await failed.client.outgoing.requestSnapshot({fail: true})
            await member.client.outgoing.requestSnapshot({})
            await until(() => member.received.length === 1)

            await member.client.outgoing.publish({value: 5})
            await until(() => member.received.length === 2)
            await wait(50)

            expect(failed.received).toEqual([])
        } finally {
            await failed.client.disconnect()
            await member.client.disconnect()
        }
    })

    test("a closed connection leaves; the rest keep receiving", async () => {
        const leaving = await connect()
        const staying = await connect()
        try {
            await leaving.client.outgoing.requestSnapshot({})
            await staying.client.outgoing.requestSnapshot({})
            await until(() => leaving.received.length === 1 && staying.received.length === 1)

            await leaving.client.disconnect()
            await staying.client.outgoing.publish({value: 6})
            await until(() => staying.received.length === 2)

            expect(staying.received[1]).toEqual({value: 6})
            expect(leaving.received).toHaveLength(1)
        } finally {
            await staying.client.disconnect()
        }
    })
})
