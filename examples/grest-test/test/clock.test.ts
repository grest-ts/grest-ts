import {callOn, GGDateShim, GGTest} from "@grest-ts/testkit"
import {GGSocket} from "@grest-ts/websocket"
import type {SocketAdapter} from "@grest-ts/websocket/internal"
import {ClockInlineRuntime, ClockLateRuntime, ClockWorkerRuntime} from "../src/ClockRuntime"
import {ClockIsolatedRuntime} from "../src/ClockIsolatedRuntime"
import {ClockLateIsolatedRuntime} from "../src/ClockLateIsolatedRuntime"
import {ClockInlineApi, ClockIsolatedApi, ClockLateApi, ClockWorkerApi} from "../src/api/ClockApi"

const DAY = 24 * 3600_000
const T = Date.parse("2030-01-01T00:00:00Z")
const SLACK = 5_000

const realNow = GGDateShim.realNow
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const runtimes = {
    inline: callOn(ClockInlineApi),
    worker: callOn(ClockWorkerApi),
    isolated: callOn(ClockIsolatedApi),
}

async function readAll(): Promise<number[]> {
    const readings = await Promise.all(Object.values(runtimes).map(api => api.read()))
    return [Date.now(), ...readings.map(r => r.now)]
}

async function expectAllNear(expected: number): Promise<void> {
    for (const now of await readAll()) {
        expect(now).toBeGreaterThanOrEqual(expected)
        expect(now).toBeLessThan(expected + SLACK)
    }
}

describe("GGTest.clock", () => {
    GGTest.startInline(ClockInlineRuntime)
    GGTest.startWorker(ClockWorkerRuntime)
    GGTest.startIsolated(ClockIsolatedRuntime)

    test("defaults to real time", async () => {
        const start = realNow()
        await expectAllNear(start - 1)
    })

    test("set reaches the test, inline, worker and isolated runtimes, and time keeps flowing", async () => {
        await GGTest.clock.set(new Date(T))
        await expectAllNear(T)

        const before = Date.now()
        await sleep(30)
        expect(Date.now()).toBeGreaterThan(before)
        expect((await runtimes.worker.read()).now).toBeGreaterThan(before)
    })

    test("a clock set in a test is undone after it", async () => {
        await expectAllNear(realNow() - 1)
    })

    test("advance jumps every isolate forward", async () => {
        await GGTest.clock.set(T)
        await GGTest.clock.advance(40 * DAY)
        await expectAllNear(T + 40 * DAY)
    })

    test("advance rejects a negative duration", () => {
        expect(() => GGTest.clock.advance(-1)).toThrow(/non-negative/)
    })

    test("stop freezes time everywhere, start lets it flow again", async () => {
        await GGTest.clock.set(T)
        await GGTest.clock.stop()
        const frozen = Date.now()
        await sleep(30)
        expect(new Set(await readAll())).toEqual(new Set([frozen]))

        await GGTest.clock.advance(1_000)
        expect(new Set(await readAll())).toEqual(new Set([frozen + 1_000]))

        await GGTest.clock.start()
        await sleep(30)
        for (const now of await readAll()) expect(now).toBeGreaterThan(frozen + 1_000)
        expect(GGTest.clock.now()).toBeLessThan(frozen + 1_000 + SLACK)
    })

    test("a runtime started inside the test after set sees the fake time", async () => {
        await GGTest.clock.set(T)
        await GGTest.startWorker(ClockLateRuntime)
        const reading = await callOn(ClockLateApi).read()
        expect(reading.now).toBeGreaterThanOrEqual(T)
        expect(reading.now).toBeLessThan(T + SLACK)
    })

    test.each([
        ["worker", () => GGTest.startWorker(ClockLateRuntime)],
        ["isolated", () => GGTest.startIsolated(ClockLateIsolatedRuntime)],
    ])("a %s runtime module evaluated after set reads the fake time at import", async (_, start) => {
        await GGTest.clock.set(T)
        await start()
        const {boot} = await callOn(ClockLateApi).read()
        expect(boot).toBeGreaterThanOrEqual(T)
        expect(boot).toBeLessThan(T + SLACK)
    })

    test("Temporal.Now follows the clock", async () => {
        await GGTest.clock.set(T)
        const Temporal = (globalThis as any).Temporal
        if (!Temporal) return
        const instant = Temporal.Now.instant().epochMilliseconds
        expect(instant).toBeGreaterThanOrEqual(T)
        expect(instant).toBeLessThan(T + SLACK)
        expect(Temporal.Now.plainDateISO("UTC").toString()).toBe("2030-01-01")
        expect(Temporal.Now.zonedDateTimeISO("UTC").year).toBe(2030)
    })

    test("set and advance reject times that aren't whole milliseconds", () => {
        expect(() => GGTest.clock.set(new Date("bad"))).toThrow(/not a valid time/)
        expect(() => GGTest.clock.set(NaN)).toThrow(/not a valid time/)
        expect(() => GGTest.clock.set(T + 0.5)).toThrow(/not a valid time/)
        expect(() => GGTest.clock.advance(Infinity)).toThrow(/integer/)
        expect(() => GGTest.clock.advance(0.5)).toThrow(/integer/)
    })

    test("explicit dates, Date.parse, Date.UTC and instanceof are unaffected", async () => {
        await GGTest.clock.set(T)
        expect(new Date(0).getTime()).toBe(0)
        expect(new Date(2020, 0, 2).getFullYear()).toBe(2020)
        expect(Date.parse("2020-01-02T03:04:05Z")).toBe(1577934245000)
        expect(Date.UTC(2020, 0, 2, 3, 4, 5)).toBe(1577934245000)
        expect(new Date()).toBeInstanceOf(Date)
        expect(new Date().constructor).toBe(Date)
        expect(structuredClone(new Date(5))).toBeInstanceOf(Date)
        expect(Date()).toBe(new Date(Date.now()).toString())

        for (const api of Object.values(runtimes)) {
            await api.read().toMatchObject({fixed: 1577934245000, isDate: true})
        }
    })

    test("vi.useFakeTimers faking Date is detected", () => {
        vi.useFakeTimers({toFake: ["Date"]})
        try {
            expect(() => GGTest.clock.now()).toThrow(/vi.useFakeTimers faked Date/)
            expect(() => GGTest.clock.set(T)).toThrow(/vi.useFakeTimers faked Date/)
        } finally {
            vi.useRealTimers()
        }
        expect(GGTest.clock.now()).toBeGreaterThan(0)
    })

    describe("a clock set at describe level", () => {
        GGTest.clock.set(T + DAY)

        test("holds for the block", async () => {
            await expectAllNear(T + DAY)
            await GGTest.clock.advance(DAY)
        })

        test("and a test's change to it is undone", async () => {
            await expectAllNear(T + DAY)
        })
    })

    describe("a clock set in beforeEach", () => {
        beforeEach(async () => {
            await GGTest.clock.set(T)
        })

        test("applies to the test", async () => {
            await expectAllNear(T)
            await GGTest.clock.advance(DAY)
        })

        test("applies again to the next one", async () => {
            await expectAllNear(T)
        })
    })

    describe("a test that fails after set", () => {
        test.fails("throws", async () => {
            await GGTest.clock.set(T)
            throw new Error("fails on purpose")
        })

        test("still has its clock undone", async () => {
            await expectAllNear(realNow() - 1)
        })
    })

    describe("two nested blocks that both set", () => {
        GGTest.clock.set(T)

        describe("the inner block", () => {
            GGTest.clock.set(T + DAY)

            test("sees the inner time", async () => {
                await expectAllNear(T + DAY)
            })
        })

        test("the outer block gets its time back", async () => {
            await expectAllNear(T)
        })
    })

    test("is undone after its block", async () => {
        await expectAllNear(realNow() - 1)
    })
})

describe("GGTest.clock set in beforeAll", () => {
    GGTest.startWorker(ClockWorkerRuntime)

    beforeAll(async () => {
        await GGTest.clock.set(T)
    })

    test("holds for the file", async () => {
        expect((await runtimes.worker.read()).now).toBeGreaterThanOrEqual(T)
    })

    test("still holds in the next test", async () => {
        expect(Date.now()).toBeGreaterThanOrEqual(T)
        expect((await runtimes.worker.read()).now).toBeGreaterThanOrEqual(T)
    })
})

describe("GGTest.clock after a file that set it", () => {
    GGTest.startWorker(ClockWorkerRuntime)

    test("is back on real time", async () => {
        const start = realNow()
        expect(Date.now()).toBeLessThan(start + SLACK)
        expect((await runtimes.worker.read()).now).toBeLessThan(start + SLACK)
    })
})

class LinkedAdapter implements SocketAdapter {
    peer!: LinkedAdapter
    private msg: Array<(d: string) => void> = []
    private cls: Array<() => void> = []
    send(m: string): void { const p = this.peer; queueMicrotask(() => p.msg.forEach(h => h(m))) }
    close(): void { this.cls.forEach(h => h()) }
    onOpen(): void {} onMessage(h: (d: string) => void): void { this.msg.push(h) } onClose(h: () => void): void { this.cls.push(h) }
    onError(): void {} offOpen(): void {} offMessage(): void {} offClose(): void {} offError(): void {}
}

describe("GGTest.clock and an open websocket", () => {
    test("a jump doesn't close the connection as idle", async () => {
        const a = new LinkedAdapter(), b = new LinkedAdapter()
        a.peer = b; b.peer = a
        const client = new GGSocket(a), server = new GGSocket(b)
        let closed = false
        client.onClose(() => { closed = true })
        client.startHeartbeat({intervalMs: 50, timeoutMs: 150})

        await GGTest.clock.advance(DAY)
        await sleep(400)
        expect(closed).toBe(false)

        client.close(); server.close()
    })
})
