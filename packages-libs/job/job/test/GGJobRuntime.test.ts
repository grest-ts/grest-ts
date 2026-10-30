import {GGTest, mockOf} from "@grest-ts/testkit"
import type {} from "@grest-ts/config/testkit"
import type {} from "@grest-ts/job/testkit"
import {sleep} from "@grest-ts/common"
import {COUNTING, CountingSource, JobTestConfig, JobTestRuntime, processed} from "./JobTestRuntime"

describe("GGJobRunner in a GGTest runtime", () => {
    const t = GGTest.startInline(JobTestRuntime)

    test("jobs don't run on their own", async () => {
        await sleep(300)
        expect(processed).toEqual([])
    })

    test("t.jobs.run runs a job now and reports it", async () => {
        await t.jobs.run("counting").toEqual({result: "DONE", rows: 1, failed: 0, batches: 1})
        expect(processed).toHaveLength(1)
    })

    test("a run sees the test's mocks", async () => {
        await t.jobs.run("counting")
            .with(mockOf(CountingSource).rows.andReturn([7, -1, 8]))
            .toEqual({result: "DONE", rows: 3, failed: 1, batches: 1})
    })

    test("a disabled job reports DISABLED", async () => {
        await t.config.update(JobTestConfig.counting, {...COUNTING, enabled: false})
        await t.jobs.run("counting").toMatchObject({result: "DISABLED", rows: 0})
        await t.config.update(JobTestConfig.counting, COUNTING)
    })

    test("a run that fails, or of an unknown job, fails the test action", async () => {
        await expect(t.jobs.run("counting").with(mockOf(CountingSource).rows.andReturn(() => { throw new Error("db down") }))).rejects.toThrow(/db down/)
        await expect(t.jobs.run("nope")).rejects.toThrow(/No job nope/)
    })

    test("t.jobs.start runs them on their schedule, and settings apply live", async () => {
        await t.jobs.start()
        const started = processed.length
        await vi.waitFor(() => expect(processed.length).toBeGreaterThan(started + 1))

        await t.config.update(JobTestConfig.counting, {...COUNTING, enabled: false})
        await sleep(100)
        const count = processed.length
        await sleep(300)
        expect(processed.length).toBe(count)

        await t.config.update(JobTestConfig.counting, {...COUNTING, enabled: true})
        await vi.waitFor(() => expect(processed.length).toBeGreaterThan(count))
    })
})
