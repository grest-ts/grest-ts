import {GGTest} from "@grest-ts/testkit"
import type {} from "@grest-ts/config/testkit"
import type {} from "@grest-ts/job/testkit"
import {COOLDOWN, ClockJobRuntime, runs} from "./ClockJobRuntime"

describe("GGJobRunner and GGTest.clock", () => {
    const t = GGTest.startInline(ClockJobRuntime)

    test("jobs.start then advance runs a scheduled job once; its cooldown ends with the interval", async () => {
        await t.jobs.start()
        await GGTest.clock.advance(COOLDOWN.startupDelayMs)
        expect(runs.cooldown).toBe(1)

        await t.jobs.run("cooldown").toMatchObject({result: "BUSY"})

        await GGTest.clock.advance(COOLDOWN.intervalMs)
        expect(runs.cooldown).toBe(2)
        await t.jobs.run("cooldown").toMatchObject({result: "BUSY"})
    })
})

describe("GGJobRunner run and GGTest.clock", () => {
    const t = GGTest.startInline(ClockJobRuntime)

    test("a run, an advance of its interval, and another run are both DONE", async () => {
        await t.jobs.run("cooldown").toMatchObject({result: "DONE"})
        await GGTest.clock.advance(COOLDOWN.intervalMs)
        await t.jobs.run("cooldown").toMatchObject({result: "DONE"})
    })

    test("a run loses its lock when the clock jumps past the lock's TTL", async () => {
        const run = Promise.resolve(t.jobs.run("blocking").toMatchObject({result: "LOST"}))
        await vi.waitFor(() => expect(runs.blocking).toBe(1))
        await GGTest.clock.advance(COOLDOWN.timeoutMs)
        await run
    })
})
