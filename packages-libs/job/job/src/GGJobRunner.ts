import {GGLocator, GGLocatorKey, GGLocatorServiceType, type GGLocatorScope} from "@grest-ts/locator"
import {GGLog} from "@grest-ts/logger"
import {GG_METRICS} from "@grest-ts/metrics"
import {type GGLock, newLockOwner, withLock} from "@grest-ts/lock"
import type {GGJob} from "./GGJob"
import {GGJobMetrics} from "./GGJobMetrics"

export const GG_JOB_RUNNER = new GGLocatorKey<GGJobRunner>("GGJobRunner")

const DEFAULT_LIMIT = 500
const MIN_CHECK_EVERY_MS = 60_000
const MAX_CHECK_EVERY_MS = 15 * 60_000
const WARN_RATIO = 0.7

export interface GGJobRunnerOptions {
    lock: GGLock
    /** Unique per runner. Default `newLockOwner()`. */
    owner?: string
}

export interface GGJobRunResult {
    /** `BUSY`: another run or a cooldown holds the lock. `DISABLED`: the job's `enabled` setting is false. */
    result: "DONE" | "BUSY" | "LOST" | "DISABLED"
    rows: number
    failed: number
    batches: number
}

/** Runs its jobs from runtime start until teardown, which stops new rows, waits for running ones and frees locks. */
export class GGJobRunner {

    private readonly owner: string
    private readonly lock: GGLock
    private readonly scope: GGLocatorScope
    private readonly loops: JobLoop[] = []
    private started = false
    private stopped = false

    constructor(options: GGJobRunnerOptions) {
        this.owner = options.owner ?? newLockOwner()
        this.lock = options.lock
        this.scope = GGLocator.getScope()
        this.scope.setWithLifecycle(GG_JOB_RUNNER, this, {
            type: GGLocatorServiceType.PERIODIC_JOBS,
            start: () => this.start(),
            teardown: () => this.stop(),
        })
    }

    add(...jobs: GGJob<any>[]): this {
        for (const job of jobs) {
            if (this.loops.some(l => l.job.config.name === job.config.name)) throw new Error(`Job ${job.config.name} added twice`)
            const loop = new JobLoop(job, this.scope, this.lock, this.owner)
            this.loops.push(loop)
            if (this.started && !this.stopped) loop.start()
        }
        return this
    }

    has(name: string): boolean {
        return this.loops.some(l => l.job.config.name === name)
    }

    /** Runs a job now, outside its schedule, and leaves the schedule as it was. Rejects when the run fails. */
    async run(name: string): Promise<GGJobRunResult> {
        const loop = this.loops.find(l => l.job.config.name === name)
        if (!loop) throw new Error(`No job ${name} (jobs: ${this.loops.map(l => l.job.config.name).join(", ")})`)
        return loop.runNow()
    }

    start(): void {
        if (this.started) return
        this.started = true
        for (const loop of this.loops) loop.start()
        GGLog.info(this, "Job runner started", {owner: this.owner, jobs: this.loops.map(l => l.job.config.name)})
    }

    async stop(): Promise<void> {
        this.stopped = true
        await Promise.all(this.loops.map(l => l.stop()))
    }
}

interface RunConfig {
    enabled: boolean
    intervalMs: number
    timeoutMs: number
    limit: number
    parallel: number
    maxExtraRuns: number
    checkEveryMs: number
}

class JobLoop {

    readonly job: GGJob<unknown>
    private readonly scope: GGLocatorScope
    private readonly lock: GGLock
    private readonly owner: string
    private timer?: NodeJS.Timeout
    private running?: Promise<unknown>
    private lastConfig?: RunConfig
    private readonly stopped = new AbortController()

    constructor(job: GGJob<unknown>, scope: GGLocatorScope, lock: GGLock, owner: string) {
        this.job = job
        this.scope = scope
        this.lock = lock
        this.owner = owner
    }

    start(): void {
        let startupDelayMs: number | undefined
        try {
            startupDelayMs = this.job.config.settings.get().startupDelayMs
        } catch {
            // tick() reports it.
        }
        this.schedule(startupDelayMs ?? 1_000 + Math.random() * 1_000)
    }

    async stop(): Promise<void> {
        this.stopped.abort()
        clearTimeout(this.timer)
        await this.running
    }

    private get oneInstance(): boolean {
        return (this.job.config.runOn ?? "oneInstance") === "oneInstance"
    }

    private schedule(ms: number): void {
        this.timer = this.scope.setTimeout(() => this.tick(), ms)
        this.timer.unref()
    }

    private runConfig(): RunConfig {
        const s = this.job.config.settings.get()
        return {
            enabled: s.enabled ?? true,
            intervalMs: s.intervalMs,
            timeoutMs: s.timeoutMs,
            limit: s.limit ?? DEFAULT_LIMIT,
            parallel: s.parallel ?? 1,
            maxExtraRuns: s.maxExtraRuns ?? 0,
            checkEveryMs: Math.min(s.intervalMs, s.checkEveryMs ?? Math.max(MIN_CHECK_EVERY_MS, Math.min(s.intervalMs / 10, MAX_CHECK_EVERY_MS))),
        }
    }

    private tick(): void {
        if (this.stopped.signal.aborted) return
        let config: RunConfig
        try {
            config = this.lastConfig = this.runConfig()
        } catch (err) {
            // An unreadable setting must not end the loop: keep the last good one, or retry in a minute.
            GGLog.error(this.job, "Job settings unreadable", {job: this.job.config.name, err: (err as Error).message})
            if (!this.lastConfig) return this.schedule(MIN_CHECK_EVERY_MS)
            config = this.lastConfig
        }
        if (config.enabled && !this.running) {
            this.track(this.runOnce(config, true))
                .catch(err => GGLog.error(this.job, "Job run failed", {job: this.job.config.name, err: (err as Error).message}))
        }
        this.schedule(this.oneInstance ? config.checkEveryMs : config.intervalMs)
    }

    async runNow(): Promise<GGJobRunResult> {
        const config = this.runConfig()
        if (!config.enabled) return {result: "DISABLED", rows: 0, failed: 0, batches: 0}
        if (this.running) return {result: "BUSY", rows: 0, failed: 0, batches: 0}
        return this.track(this.runOnce(config, false))
    }

    private track<T>(run: Promise<T>): Promise<T> {
        this.running = run.catch(() => {}).finally(() => { this.running = undefined })
        return run
    }

    private async runOnce(config: RunConfig, hold: boolean): Promise<GGJobRunResult> {
        const name = this.job.config.name
        const signal = this.stopped.signal
        const startedAt = Date.now()
        const overdue = this.scope.setTimeout(() => {
            GGLog.warn(this.job, "Job still running past its timeout", {job: name, timeoutMs: config.timeoutMs})
        }, config.timeoutMs)
        overdue.unref()
        let totals = {rows: 0, failed: 0, batches: 0}
        const run = async (s: AbortSignal) => {
            metric(() => GGJobMetrics.runs.inc(1, {job: name}))
            try {
                totals = await this.runBatches(config, s)
            } finally {
                const durationMs = Date.now() - startedAt
                metric(() => GGJobMetrics.runDuration.inc(durationMs, {job: name}))
                if (durationMs > config.intervalMs * WARN_RATIO) GGLog.warn(this.job, "Job run took most of its interval", {job: name, durationMs, intervalMs: config.intervalMs})
            }
        }
        try {
            if (this.oneInstance) {
                const {lock, owner} = this
                // Hold the lock until the next run is due, so all instances share one run per interval. The slack
                // absorbs clock skew: a check that finds the run just short of due must not delay it a whole check.
                const holdUntil = hold ? startedAt + config.intervalMs - config.checkEveryMs / 10 : undefined
                const result = await withLock(lock, name, {owner, ttlMs: config.timeoutMs, signal, holdUntil}, s => {
                    GGLog.info(this.job, "Job run", {job: name, owner})
                    return run(s)
                })
                if (result === "LOST") metric(() => GGJobMetrics.lockLost.inc(1, {job: name}))
                return {result, ...totals}
            }
            await run(signal)
            return {result: "DONE", ...totals}
        } finally {
            clearTimeout(overdue)
        }
    }

    private async runBatches({limit, parallel, maxExtraRuns}: RunConfig, signal: AbortSignal): Promise<{rows: number, failed: number, batches: number}> {
        const name = this.job.config.name
        const totals = {rows: 0, failed: 0, batches: 0}
        for (let extra = 0; ; extra++) {
            const startedAt = Date.now()
            const rows = await this.job.getDataSet(limit)
            if (rows.length > limit) GGLog.warn(this.job, "Job data set exceeds its limit", {job: name, rows: rows.length, limit})
            else if (rows.length > Math.ceil(limit * WARN_RATIO)) GGLog.warn(this.job, "Job data set is near its limit", {job: name, rows: rows.length, limit})

            let next = 0
            let failed = 0
            const worker = async () => {
                while (next < rows.length && !signal.aborted) {
                    if (!await this.runRow(rows[next++], signal)) failed++
                }
            }
            await Promise.all(Array.from({length: Math.min(parallel, rows.length)}, worker))

            totals.rows += rows.length
            totals.failed += failed
            totals.batches++
            const report = {rows: rows.length, failed, durationMs: Date.now() - startedAt}
            if (rows.length > 0) GGLog.info(this.job, "Job batch done", {job: name, ...report})
            await this.job.dataSetFinished?.(report)
                .catch(err => GGLog.warn(this.job, "Job dataSetFinished failed", {job: name, err: (err as Error).message}))
            if (signal.aborted || failed > 0 || rows.length < limit || extra >= maxExtraRuns) return totals
        }
    }

    private async runRow(row: unknown, signal: AbortSignal): Promise<boolean> {
        const job = this.job.config.name
        metric(() => GGJobMetrics.rowsInFlight.inc(1, {job}))
        try {
            await this.job.processRow(row, signal)
            metric(() => GGJobMetrics.rows.inc(1, {job, result: "OK"}))
            return true
        } catch (err) {
            metric(() => GGJobMetrics.rows.inc(1, {job, result: "ERROR"}))
            GGLog.warn(this.job, "Job row failed", {job, row: this.describe(row), err: (err as Error).message})
            return false
        } finally {
            metric(() => GGJobMetrics.rowsInFlight.dec(1, {job}))
        }
    }

    private describe(row: unknown): unknown {
        try {
            return this.job.describeRow(row)
        } catch {
            return "<describeRow failed>"
        }
    }
}

function metric(record: () => void): void {
    if (GG_METRICS.has()) record()
}
