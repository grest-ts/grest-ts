import {GGTest} from "@grest-ts/testkit"
import type {} from "@grest-ts/config/testkit"
import {IsPosInt} from "@grest-ts/schema"
import {JobTestConfig, JobTestRuntime, processed} from "./JobTestRuntime"

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

describe("GGJobRunner in a runtime", () => {
    const t = GGTest.startInline(JobTestRuntime)

    test("runs its jobs from runtime start", async () => {
        await vi.waitFor(() => expect(processed.length).toBeGreaterThan(1))
    })

    test("enabled: false stops the runs until it is set back", async () => {
        await t.config.update(JobTestConfig.counting, {enabled: false})
        await sleep(100)
        const count = processed.length
        await sleep(300)
        expect(processed.length).toBe(count)

        await t.config.update(JobTestConfig.counting, {enabled: true})
        await vi.waitFor(() => expect(processed.length).toBeGreaterThan(count))
    })

    test("a live intervalMs replaces the configured one", async () => {
        await t.config.update(JobTestConfig.counting, {intervalMs: IsPosInt.parse(10_000)})
        await sleep(100)
        const count = processed.length
        await sleep(300)
        expect(processed.length).toBe(count)
    })
})
