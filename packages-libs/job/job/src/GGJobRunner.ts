import {GGLocator, GGLocatorKey, GGLocatorServiceType, type GGLocatorScope} from "@grest-ts/locator"
import {GGLog} from "@grest-ts/logger"
import {GG_METRICS} from "@grest-ts/metrics"
import {type GGLock, newLockOwner, withLock} from "@grest-ts/lock"
import type {GGJob} from "./GGJob"
import {GGJobMetrics} from "./GGJobMetrics"

const GG_JOB_RUNNER = new GGLocatorKey<GGJobRunner>("GGJobRunner")

const DEFAULT_LIMIT = 500
const MIN_CHECK_EVERY_MS = 60_000
const MAX_CHECK_EVERY_MS = 15 * 60_000
const WARN_RATIO = 0.7

export interface GGJobRunnerOptions {
    /** What `oneInstance` jobs coordinate through. */
    lock: GGLock
    /** Unique per runner. Default `newLockOwner()`. */
    owner?: string
}

/** Runs its jobs from runtime start until teardown, which stops new rows, waits for running ones and frees locks. */
export class GGJobRunner {

    readonly owner: string
    readonly lock: GGLock
    readonly scope: GGLocatorScope

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
            const loop = new JobLoop(job, this)
            this.loops.push(loop)
            if (this.started && !this.stopped) loop.start()
        }
        return this
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
    private readonly runner: GGJobRunner
    private timer?: NodeJS.Timeout
    private running?: Promise<void>
    private lastConfig?: RunConfig
    private readonly stopped = new AbortController()

    constructor(job: GGJob<unknown>, runner: GGJobRunner) {
        this.job = job
        this.runner = runner
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
        this.timer = this.runner.scope.setTimeout(() => this.tick(), ms)
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
            this.running = this.runOnce(config)
                .catch(err => GGLog.error(this.job, "Job run failed", {job: this.job.config.name, err: (err as Error).message}))
                .finally(() => { this.running = undefined })
        }
        this.schedule(this.oneInstance ? config.checkEveryMs : config.intervalMs)
    }

    private async runOnce(config: RunConfig): Promise<void> {
        const name = this.job.config.name
        const signal = this.stopped.signal
        const startedAt = Date.now()
        const overdue = this.runner.scope.setTimeout(() => {
            GGLog.warn(this.job, "Job still running past its timeout", {job: name, timeoutMs: config.timeoutMs})
        }, config.timeoutMs)
        overdue.unref()
        const run = async (s: AbortSignal) => {
            metric(() => GGJobMetrics.runs.inc(1, {job: name}))
            try {
                await this.runBatches(config, s)
            } finally {
                const durationMs = Date.now() - startedAt
                metric(() => GGJobMetrics.runDuration.inc(durationMs, {job: name}))
                if (durationMs > config.intervalMs * WARN_RATIO) GGLog.warn(this.job, "Job run took most of its interval", {job: name, durationMs, intervalMs: config.intervalMs})
            }
        }
        try {
            if (this.oneInstance) {
                const {lock, owner} = this.runner
                // A finished run holds the lock until the next one is due, so instances run it once per interval
                // between them. A tenth of a check of slack, for clock skew between instances: a check that finds
                // the run a moment short of due must not push it a whole check back.
                const holdUntil = startedAt + config.intervalMs - config.checkEveryMs / 10
                const result = await withLock(lock, name, {owner, ttlMs: config.timeoutMs, signal, holdUntil}, s => {
                    GGLog.info(this.job, "Job run", {job: name, owner})
                    return run(s)
                })
                if (result === "LOST") metric(() => GGJobMetrics.lockLost.inc(1, {job: name}))
            } else {
                await run(signal)
            }
        } finally {
            clearTimeout(overdue)
        }
    }

    private async runBatches({limit, parallel, maxExtraRuns}: RunConfig, signal: AbortSignal): Promise<void> {
        const name = this.job.config.name
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

            const report = {rows: rows.length, failed, durationMs: Date.now() - startedAt}
            if (rows.length > 0) GGLog.info(this.job, "Job batch done", {job: name, ...report})
            await this.job.dataSetFinished?.(report)
                .catch(err => GGLog.warn(this.job, "Job dataSetFinished failed", {job: name, err: (err as Error).message}))
            if (signal.aborted || failed > 0 || rows.length < limit || extra >= maxExtraRuns) return
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
