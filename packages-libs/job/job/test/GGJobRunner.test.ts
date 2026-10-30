import {afterEach, beforeEach, describe, expect, test, vi} from "vitest"
import {GGLocatorScope} from "@grest-ts/locator"
import {GGLog} from "@grest-ts/logger"
import {sleep} from "@grest-ts/common"
import {GGMetricsLoader, GG_METRICS} from "@grest-ts/metrics"
import {GGJob, GGJobInstanceLock, GGJobMetrics, GGJobRunner, type GGJobConfig, type GGJobLock} from "@grest-ts/job"
import {runJobOnce} from "@grest-ts/job/testkit"

// Each runner gets its own scope, as each instance has its own runtime; sharing one lock makes them one fleet.
function newRunner(lock: GGJobLock, owner: string): GGJobRunner {
    const scope = new GGLocatorScope(owner, undefined, owner)
    GGLog.init(scope)
    return scope.run(() => {
        scope.setLifecycleOwner(() => {})
        new GGMetricsLoader()
        return new GGJobRunner({lock, owner})
    })
}

function stubLock(overrides: Partial<GGJobLock> = {}): GGJobLock {
    return {acquire: async () => true, renew: async () => true, release: async () => {}, ...overrides}
}

const untilAborted = (_row: string, signal: AbortSignal) => new Promise<void>(r => signal.addEventListener("abort", () => r()))

function rowCount(runner: GGJobRunner, result: "OK" | "ERROR"): unknown {
    return runner.scope.run(() => GG_METRICS.get().get(GGJobMetrics.rows).getValue({job: "test", result}))
}

class TestJob extends GGJob<string> {
    readonly processed: string[] = []
    running = 0
    maxRunning = 0

    private readonly rows: () => string[]
    private readonly onRow: (row: string, signal: AbortSignal) => Promise<void>

    constructor(
        config: Partial<GGJobConfig>,
        rows: () => string[] = () => ["row"],
        onRow: (row: string, signal: AbortSignal) => Promise<void> = async () => {},
    ) {
        super({name: "test", lock: "exclusive", intervalMs: 10_000, timeoutMs: 3_000, checkEveryMs: 1_000, startupDelayMs: 1_000, ...config})
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

    rowKey(row: string): string {
        return row
    }
}


describe("GGJobRunner", () => {
    beforeEach(() => { vi.useFakeTimers({now: 1_000_000}) })
    afterEach(() => { vi.useRealTimers() })

    test("exclusive: two instances run the job once per interval between them", async () => {
        const lock = new GGJobInstanceLock()
        const a = new TestJob({startupDelayMs: 1_000})
        const b = new TestJob({startupDelayMs: 1_500})
        newRunner(lock, "a").add(a).start()
        newRunner(lock, "b").add(b).start()

        await vi.advanceTimersByTimeAsync(35_000)

        expect(a.processed.length + b.processed.length).toBe(4)
    })

    test("exclusive: an hourly job asks for its lock every 6 min by default", async () => {
        const lock = new GGJobInstanceLock()
        const acquire = vi.spyOn(lock, "acquire")
        const job = new TestJob({intervalMs: 60 * 60_000, timeoutMs: 60_000, checkEveryMs: undefined})
        newRunner(lock, "a").add(job).start()

        await vi.advanceTimersByTimeAsync(3 * 60 * 60_000)

        expect(acquire).toHaveBeenCalledTimes(30)
        expect(job.processed).toHaveLength(3)
    })

    test("exclusive: a slow run on one instance keeps the other out", async () => {
        const lock = new GGJobInstanceLock()
        const slow = async () => sleep(25_000)
        const a = new TestJob({startupDelayMs: 1_000}, undefined, slow)
        const b = new TestJob({startupDelayMs: 1_500}, undefined, slow)
        newRunner(lock, "a").add(a).start()
        newRunner(lock, "b").add(b).start()

        await vi.advanceTimersByTimeAsync(20_000)

        expect(a.running + b.running).toBe(1)
    })

    test("exclusive: when the instance that ran it stops, the other runs it when it is next due", async () => {
        const lock = new GGJobInstanceLock()
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

    test("exclusive: a run interrupted by stop is picked up by the other instance straight away", async () => {
        const lock = new GGJobInstanceLock()
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

    test("exclusive: a lost lock aborts the run, skips the rows not yet started and is not released", async () => {
        const release = vi.fn(async () => {})
        const lock = stubLock({renew: async () => false, release})
        const job = new TestJob({checkEveryMs: 60_000}, () => ["r1", "r2"], untilAborted)
        newRunner(lock, "a").add(job).start()

        await vi.advanceTimersByTimeAsync(3_000)

        expect(job.processed).toEqual(["r1"])
        expect(release).not.toHaveBeenCalled()
    })

    test("item: instances share a draining data set and each row's work runs once", async () => {
        const lock = new GGJobInstanceLock()
        const pending = new Set(["r1", "r2", "r3", "r4", "r5", "r6"])
        const done: string[] = []
        const rows = () => [...pending]
        // Re-checks under the row lock: the row was read before another instance may have finished it.
        const work = async (row: string) => {
            if (!pending.has(row)) return
            await sleep(500)
            pending.delete(row)
            done.push(row)
        }
        const a = new TestJob({lock: "item", startupDelayMs: 1_000, parallel: 2}, rows, work)
        const b = new TestJob({lock: "item", startupDelayMs: 1_000, parallel: 2}, rows, work)
        newRunner(lock, "a").add(a).start()
        newRunner(lock, "b").add(b).start()

        await vi.advanceTimersByTimeAsync(30_000)

        expect(done.sort()).toEqual(["r1", "r2", "r3", "r4", "r5", "r6"])
        expect(a.processed.length).toBeGreaterThan(0)
        expect(b.processed.length).toBeGreaterThan(0)
    })

    test("a failing row is logged and the rest of the batch still runs", async () => {
        const job = new TestJob({lock: "none"}, () => ["bad", "good"], async row => {
            if (row === "bad") throw new Error("boom")
        })
        newRunner(new GGJobInstanceLock(), "a").add(job).start()

        await vi.advanceTimersByTimeAsync(1_500)

        expect(job.processed).toEqual(["good"])
    })

    test("a full batch runs again up to maxExtraRuns, in parallel up to `parallel`", async () => {
        const pending = Array.from({length: 10}, (_, i) => `r${i}`)
        const job = new TestJob({lock: "none", limit: 3, maxExtraRuns: 2, parallel: 3}, () => pending, async row => {
            await sleep(10)
            pending.splice(pending.indexOf(row), 1)
        })
        newRunner(new GGJobInstanceLock(), "a").add(job).start()

        await vi.advanceTimersByTimeAsync(2_000)

        expect(job.processed).toHaveLength(9)
        expect(job.maxRunning).toBe(3)
    })

    test("item locking without rowKey is refused", () => {
        class NoKey extends GGJob<string> {
            constructor() { super({name: "nokey", lock: "item", intervalMs: 1_000, timeoutMs: 1_000}) }
            async getDataSet() { return [] }
            async processRow() {}
        }
        expect(() => newRunner(new GGJobInstanceLock(), "a").add(new NoKey())).toThrow(/rowKey/)
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

        runner.scope.run(() => {
            const metrics = GG_METRICS.get()
            expect(metrics.get(GGJobMetrics.runs).getValue({job: "metered"})).toBe(1)
            expect(metrics.get(GGJobMetrics.rows).getValue({job: "metered", result: "OK"})).toBe(2)
            expect(metrics.get(GGJobMetrics.rows).getValue({job: "metered", result: "ERROR"})).toBe(1)
            expect(metrics.get(GGJobMetrics.rowsInFlight).getValue({job: "metered"})).toBe(0)
            expect(metrics.get(GGJobMetrics.lockLost).getValue({job: "metered"})).toBe(1)
        })
    })

    test("runJobOnce runs one batch and returns row errors instead of throwing", async () => {
        const job = new TestJob({lock: "none"}, () => ["bad", "good"], async row => {
            if (row === "bad") throw new Error("boom")
        })

        const {rows, errors} = await runJobOnce(job)

        expect(rows).toEqual(["bad", "good"])
        expect(errors).toHaveLength(1)
        expect(job.processed).toEqual(["good"])
    })

    test("exclusive: a short interval checked once per interval still runs at most once per interval", async () => {
        const lock = new GGJobInstanceLock()
        const a = new TestJob({intervalMs: 30_000, checkEveryMs: undefined, startupDelayMs: 1_000})
        const b = new TestJob({intervalMs: 30_000, checkEveryMs: undefined, startupDelayMs: 17_000})
        newRunner(lock, "a").add(a).start()
        newRunner(lock, "b").add(b).start()

        await vi.advanceTimersByTimeAsync(30_000)

        expect(a.processed.length + b.processed.length).toBe(1)
    })

    test("exclusive: a data set that fails to load records no last run, so the next check runs it", async () => {
        const release = vi.fn(async () => {})
        const lock = stubLock({release})
        let fail = true
        const job = new TestJob({}, () => {
            if (fail) throw new Error("db down")
            return ["row"]
        })
        newRunner(lock, "a").add(job).start()

        await vi.advanceTimersByTimeAsync(1_500)
        expect(release).toHaveBeenLastCalledWith("test", "a", undefined)

        fail = false
        await vi.advanceTimersByTimeAsync(1_000)
        expect(job.processed).toEqual(["row"])
        expect(release).toHaveBeenLastCalledWith("test", "a", expect.any(Number))
    })

    test("exclusive: renews that keep failing for two thirds of a TTL count as a lost lock", async () => {
        const lock = stubLock({renew: async () => { throw new Error("unreachable") }})
        const job = new TestJob({checkEveryMs: 60_000}, () => ["r1", "r2"], untilAborted)
        newRunner(lock, "a").add(job).start()

        await vi.advanceTimersByTimeAsync(2_500)
        expect(job.processed).toEqual([])

        await vi.advanceTimersByTimeAsync(1_000)
        expect(job.processed).toEqual(["r1"])
    })

    test("item: a row locked by another instance is skipped, not counted, and ends the run's extra batches", async () => {
        const lock = new GGJobInstanceLock()
        await lock.acquire("test#r1", "other", 60_000)
        const getDataSet = vi.fn(() => ["r1"])
        const job = new TestJob({lock: "item", limit: 1, maxExtraRuns: 3}, getDataSet)
        const runner = newRunner(lock, "a").add(job)
        runner.start()

        await vi.advanceTimersByTimeAsync(1_500)

        expect(job.processed).toEqual([])
        expect(getDataSet).toHaveBeenCalledTimes(1)
        expect(rowCount(runner, "OK")).toBe(0)
    })

    test("a row whose describeRow throws is still counted as failed", async () => {
        class BadDescribe extends TestJob {
            describeRow(): unknown { throw new Error("describe") }
        }
        const job = new BadDescribe({lock: "none"}, () => ["bad", "good"], async row => {
            if (row === "bad") throw new Error("boom")
        })
        newRunner(new GGJobInstanceLock(), "a").add(job).start()

        await vi.advanceTimersByTimeAsync(1_500)

        expect(job.processed).toEqual(["good"])
    })

    test("item: a row whose lock is lost counts as failed", async () => {
        const lock = stubLock({renew: async () => false})
        const job = new TestJob({lock: "item"}, () => ["r1"], untilAborted)
        const runner = newRunner(lock, "a").add(job)
        runner.start()

        await vi.advanceTimersByTimeAsync(2_500)

        expect(rowCount(runner, "ERROR")).toBe(1)
        expect(rowCount(runner, "OK")).toBe(0)
    })
})
