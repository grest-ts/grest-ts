import {GGTest} from "@grest-ts/testkit"
import type {} from "@grest-ts/config/testkit"
import {sleep} from "@grest-ts/common"
import {COUNTING, JobTestConfig, JobTestRuntime, processed} from "./JobTestRuntime"

describe("GGJobRunner in a runtime", () => {
    const t = GGTest.startInline(JobTestRuntime)

    test("runs its jobs from runtime start", async () => {
        await vi.waitFor(() => expect(processed.length).toBeGreaterThan(1))
    })

    test("enabled: false stops the runs until it is set back", async () => {
        await t.config.update(JobTestConfig.counting, {...COUNTING, enabled: false})
        await sleep(100)
        const count = processed.length
        await sleep(300)
        expect(processed.length).toBe(count)

        await t.config.update(JobTestConfig.counting, {...COUNTING, enabled: true})
        await vi.waitFor(() => expect(processed.length).toBeGreaterThan(count))
    })

    test("a live intervalMs replaces the configured one", async () => {
        await t.config.update(JobTestConfig.counting, {...COUNTING, intervalMs: 10_000})
        await sleep(100)
        const count = processed.length
        await sleep(300)
        expect(processed.length).toBe(count)
    })
})
