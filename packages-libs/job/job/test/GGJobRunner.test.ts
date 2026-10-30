import {afterEach, beforeEach, describe, expect, test, vi} from "vitest"
import {GGLocatorScope} from "@grest-ts/locator"
import {GGLog} from "@grest-ts/logger"
import {sleep} from "@grest-ts/common"
import {GGMetricsLoader, GG_METRICS} from "@grest-ts/metrics"
import {GGInstanceLock, type GGLock} from "@grest-ts/lock"
import {GGJob, GGJobMetrics, GGJobRunner, IsGGJobSettings, type GGJobRunOn, type GGJobSettings} from "@grest-ts/job"
import {runJobOnce} from "@grest-ts/job/testkit"

// Each runner gets its own scope, as each instance has its own runtime; sharing one lock makes them one fleet.
const scopes = new WeakMap<GGJobRunner, GGLocatorScope>()

function newRunner(lock: GGLock, owner: string): GGJobRunner {
    const scope = new GGLocatorScope(owner, undefined, owner)
    GGLog.init(scope)
    const runner = scope.run(() => {
        scope.setLifecycleOwner(() => {})
        new GGMetricsLoader()
        return new GGJobRunner({lock, owner})
    })
    scopes.set(runner, scope)
    return runner
}

function stubLock(overrides: Partial<GGLock> = {}): GGLock {
    return {acquire: async () => true, renew: async () => true, release: async () => {}, ...overrides}
}

const untilAborted = (_row: string, signal: AbortSignal) => new Promise<void>(r => signal.addEventListener("abort", () => r()))


class TestJob extends GGJob<string> {
    readonly processed: string[] = []
    running = 0
    maxRunning = 0

    private readonly rows: () => string[]
    private readonly onRow: (row: string, signal: AbortSignal) => Promise<void>

    constructor(
        config: Partial<GGJobSettings> & {name?: string, runOn?: GGJobRunOn} = {},
        rows: () => string[] = () => ["row"],
        onRow: (row: string, signal: AbortSignal) => Promise<void> = async () => {},
    ) {
        const {name = "test", runOn, ...overrides} = config
        const settings: GGJobSettings = {intervalMs: 10_000, timeoutMs: 3_000, checkEveryMs: 1_000, startupDelayMs: 1_000, ...overrides}
        super({name, runOn, settings: {get: () => settings}})
        this.rows = rows
        this.onRow = onRow
    }

    async getDataSet(limit: number): Promise<string[]> {
        return this.rows().slice(0, limit)
    }

    async processRow(row: string, signal: AbortSignal): Promise<void> {
        this.running++
        this.maxRunning = Math.max(this.maxRunning, this.running)
        try {
            await this.onRow(row, signal)
            this.processed.push(row)
        } finally {
            this.running--
        }
    }

}


describe("GGJobRunner", () => {
    beforeEach(() => { vi.useFakeTimers({now: 1_000_000}) })
    afterEach(() => { vi.useRealTimers() })

    test("oneInstance: two instances run the job once per interval between them", async () => {
        const lock = new GGInstanceLock()
        const a = new TestJob({startupDelayMs: 1_000})
        const b = new TestJob({startupDelayMs: 1_500})
        newRunner(lock, "a").add(a).start()
        newRunner(lock, "b").add(b).start()

        await vi.advanceTimersByTimeAsync(35_000)

        expect(a.processed.length + b.processed.length).toBe(4)
    })

    test("oneInstance: an hourly job asks for its lock every 6 min by default", async () => {
        const lock = new GGInstanceLock()
        const acquire = vi.spyOn(lock, "acquire")
        const job = new TestJob({intervalMs: 60 * 60_000, timeoutMs: 60_000, checkEveryMs: undefined})
        newRunner(lock, "a").add(job).start()

        await vi.advanceTimersByTimeAsync(3 * 60 * 60_000)

        expect(acquire).toHaveBeenCalledTimes(30)
        expect(job.processed).toHaveLength(3)
    })

    test("oneInstance: a slow run on one instance keeps the other out", async () => {
        const lock = new GGInstanceLock()
        const slow = async () => sleep(25_000)
        const a = new TestJob({startupDelayMs: 1_000}, undefined, slow)
        const b = new TestJob({startupDelayMs: 1_500}, undefined, slow)
        newRunner(lock, "a").add(a).start()
        newRunner(lock, "b").add(b).start()

        await vi.advanceTimersByTimeAsync(20_000)

        expect(a.running + b.running).toBe(1)
    })

    test("oneInstance: when the instance that ran it stops, the other runs it when it is next due", async () => {
        const lock = new GGInstanceLock()
        const a = new TestJob({startupDelayMs: 1_000})
        const b = new TestJob({startupDelayMs: 1_500})
        const runnerA = newRunner(lock, "a").add(a)
        runnerA.start()
        newRunner(lock, "b").add(b).start()
        await vi.advanceTimersByTimeAsync(2_000)
        expect(a.processed).toHaveLength(1)

        await runnerA.stop()
        await vi.advanceTimersByTimeAsync(10_000)

        expect(a.processed).toHaveLength(1)
        expect(b.processed).toHaveLength(1)
    })

    test("oneInstance: a run interrupted by stop is picked up by the other instance straight away", async () => {
        const lock = new GGInstanceLock()
        const a = new TestJob({startupDelayMs: 1_000}, () => ["r1", "r2"], (_row, signal) => new Promise(r => {
            signal.addEventListener("abort", () => r())
            setTimeout(r, 5_000)
        }))
        const b = new TestJob({startupDelayMs: 1_500})
        const runnerA = newRunner(lock, "a").add(a)
        runnerA.start()
        newRunner(lock, "b").add(b).start()
        await vi.advanceTimersByTimeAsync(2_000)

        await runnerA.stop()
        await vi.advanceTimersByTimeAsync(1_000)

        expect(a.processed).toEqual(["r1"])
        expect(b.processed).toEqual(["row"])
    })

    test("oneInstance: a lost lock aborts the run, skips the rows not yet started and is not released", async () => {
        const release = vi.fn(async () => {})
        const lock = stubLock({renew: async () => false, release})
        const job = new TestJob({checkEveryMs: 60_000}, () => ["r1", "r2"], untilAborted)
        newRunner(lock, "a").add(job).start()

        await vi.advanceTimersByTimeAsync(3_000)

        expect(job.processed).toEqual(["r1"])
        expect(release).not.toHaveBeenCalled()
    })

    test("a failing row is logged and the rest of the batch still runs", async () => {
        const job = new TestJob({runOn: "everyInstance"}, () => ["bad", "good"], async row => {
            if (row === "bad") throw new Error("boom")
        })
        newRunner(new GGInstanceLock(), "a").add(job).start()

        await vi.advanceTimersByTimeAsync(1_500)

        expect(job.processed).toEqual(["good"])
    })

    test("a full batch runs again up to maxExtraRuns, in parallel up to `parallel`", async () => {
        const pending = Array.from({length: 10}, (_, i) => `r${i}`)
        const job = new TestJob({runOn: "everyInstance", limit: 3, maxExtraRuns: 2, parallel: 3}, () => pending, async row => {
            await sleep(10)
            pending.splice(pending.indexOf(row), 1)
        })
        newRunner(new GGInstanceLock(), "a").add(job).start()

        await vi.advanceTimersByTimeAsync(2_000)

        expect(job.processed).toHaveLength(9)
        expect(job.maxRunning).toBe(3)
    })

    test("metrics count runs, rows by result and lost locks", async () => {
        const lock = stubLock({renew: async () => false})
        const job = new TestJob({name: "metered", checkEveryMs: 60_000}, () => ["bad", "good", "slow"], (row, signal) => {
            if (row === "bad") return Promise.reject(new Error("boom"))
            if (row === "good") return Promise.resolve()
            return new Promise(r => signal.addEventListener("abort", () => r()))
        })
        const runner = newRunner(lock, "a").add(job)
        runner.start()

        await vi.advanceTimersByTimeAsync(3_000)

        scopes.get(runner)!.run(() => {
            const metrics = GG_METRICS.get()
            expect(metrics.get(GGJobMetrics.runs).getValue({job: "metered"})).toBe(1)
            expect(metrics.get(GGJobMetrics.rows).getValue({job: "metered", result: "OK"})).toBe(2)
            expect(metrics.get(GGJobMetrics.rows).getValue({job: "metered", result: "ERROR"})).toBe(1)
            expect(metrics.get(GGJobMetrics.rowsInFlight).getValue({job: "metered"})).toBe(0)
            expect(metrics.get(GGJobMetrics.lockLost).getValue({job: "metered"})).toBe(1)
        })
    })

    test("runJobOnce runs one batch and returns row errors instead of throwing", async () => {
        const job = new TestJob({runOn: "everyInstance"}, () => ["bad", "good"], async row => {
            if (row === "bad") throw new Error("boom")
        })

        const {rows, errors} = await runJobOnce(job)

        expect(rows).toEqual(["bad", "good"])
        expect(errors).toHaveLength(1)
        expect(job.processed).toEqual(["good"])
    })

    test("oneInstance: a short interval checked once per interval still runs at most once per interval", async () => {
        const lock = new GGInstanceLock()
        const a = new TestJob({intervalMs: 30_000, checkEveryMs: undefined, startupDelayMs: 1_000})
        const b = new TestJob({intervalMs: 30_000, checkEveryMs: undefined, startupDelayMs: 17_000})
        newRunner(lock, "a").add(a).start()
        newRunner(lock, "b").add(b).start()

        await vi.advanceTimersByTimeAsync(30_000)

        expect(a.processed.length + b.processed.length).toBe(1)
    })

    test("oneInstance: a data set that fails to load releases the lock, so the next check runs it; a finished run holds it instead", async () => {
        const release = vi.fn(async () => {})
        const renew = vi.fn(async () => true)
        const lock = stubLock({release, renew})
        let fail = true
        const job = new TestJob({}, () => {
            if (fail) throw new Error("db down")
            return ["row"]
        })
        newRunner(lock, "a").add(job).start()

        await vi.advanceTimersByTimeAsync(1_500)
        expect(release).toHaveBeenCalledWith("test", "a")
        expect(renew).not.toHaveBeenCalled()

        fail = false
        await vi.advanceTimersByTimeAsync(1_000)
        expect(job.processed).toEqual(["row"])
        expect(renew).toHaveBeenLastCalledWith("test", "a", expect.any(Number))
        expect(release).toHaveBeenCalledTimes(1)
    })

    test("a row whose describeRow throws is still counted as failed", async () => {
        class BadDescribe extends TestJob {
            describeRow(): unknown { throw new Error("describe") }
        }
        const job = new BadDescribe({runOn: "everyInstance"}, () => ["bad", "good"], async row => {
            if (row === "bad") throw new Error("boom")
        })
        newRunner(new GGInstanceLock(), "a").add(job).start()

        await vi.advanceTimersByTimeAsync(1_500)

        expect(job.processed).toEqual(["good"])
    })


    test("settings are read at the start of every run", async () => {
        const getDataSet = vi.fn(async (limit: number) => [] as string[])
        let settings: GGJobSettings = {intervalMs: 1_000, timeoutMs: 3_000, startupDelayMs: 0, limit: 5}
        class Live extends GGJob<string> {
            constructor() { super({name: "live", runOn: "everyInstance", settings: {get: () => settings}}) }
            getDataSet = getDataSet
            async processRow() {}
        }
        newRunner(new GGInstanceLock(), "a").add(new Live()).start()

        await vi.advanceTimersByTimeAsync(10)
        expect(getDataSet).toHaveBeenLastCalledWith(5)

        settings = {...settings, limit: 7}
        await vi.advanceTimersByTimeAsync(1_000)
        expect(getDataSet).toHaveBeenLastCalledWith(7)

        settings = {...settings, enabled: false}
        await vi.advanceTimersByTimeAsync(3_000)
        expect(getDataSet).toHaveBeenCalledTimes(2)
    })

    test("a setting that becomes unreadable keeps the last good one instead of stopping the job", async () => {
        const getDataSet = vi.fn(async () => [] as string[])
        let broken = false
        const good: GGJobSettings = {intervalMs: 1_000, timeoutMs: 3_000, startupDelayMs: 0}
        class Flaky extends GGJob<string> {
            constructor() { super({name: "flaky", runOn: "everyInstance", settings: {get: () => { if (broken) throw new Error("bad value"); return good }}}) }
            getDataSet = getDataSet
            async processRow() {}
        }
        newRunner(new GGInstanceLock(), "a").add(new Flaky()).start()
        await vi.advanceTimersByTimeAsync(10)

        broken = true
        await vi.advanceTimersByTimeAsync(3_000)

        expect(getDataSet).toHaveBeenCalledTimes(4)
    })

    test("settings must be whole numbers", () => {
        expect(IsGGJobSettings.safeParse({intervalMs: 1_000, timeoutMs: 1_000, limit: 2.5}).success).toBe(false)
        expect(IsGGJobSettings.safeParse({intervalMs: 1_000, timeoutMs: 1_000, limit: 3}).success).toBe(true)
    })
})
