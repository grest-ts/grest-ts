import {hostname} from "node:os"
import {randomUUID} from "node:crypto"
import {GGLocator, GGLocatorKey, GGLocatorServiceType, type GGLocatorScope} from "@grest-ts/locator"
import {GGLog} from "@grest-ts/logger"
import {GG_METRICS} from "@grest-ts/metrics"
import type {GGJob} from "./GGJob"
import type {GGJobLock} from "./GGJobLock"
import {GGJobMetrics} from "./GGJobMetrics"

const GG_JOB_RUNNER = new GGLocatorKey<GGJobRunner>("GGJobRunner")

const DEFAULT_LIMIT = 500
const MIN_CHECK_EVERY_MS = 60_000
const MAX_CHECK_EVERY_MS = 15 * 60_000
const WARN_RATIO = 0.7

export interface GGJobRunnerOptions {
    lock: GGJobLock
    /** Unique per process. */
    owner?: string
}

/** Runs its jobs from runtime start until teardown, which stops new rows, waits for running ones and frees locks. */
export class GGJobRunner {

    readonly owner: string
    readonly lock: GGJobLock
    readonly scope: GGLocatorScope

    private readonly loops: JobLoop[] = []
    private started = false
    private stopped = false

    constructor(options: GGJobRunnerOptions) {
        this.owner = options.owner ?? `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`
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
            if (job.config.lock === "item" && !job.rowKey) throw new Error(`Job ${job.config.name}: item locking needs rowKey()`)
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
    private readonly stopped = new AbortController()

    constructor(job: GGJob<unknown>, runner: GGJobRunner) {
        this.job = job
        this.runner = runner
    }

    start(): void {
        this.schedule(this.job.config.startupDelayMs ?? 1_000 + Math.random() * 1_000)
    }

    async stop(): Promise<void> {
        this.stopped.abort()
        clearTimeout(this.timer)
        await this.running
    }

    private schedule(ms: number): void {
        this.timer = this.runner.scope.setTimeout(() => this.tick(), ms)
        this.timer.unref()
    }

    private runConfig(): RunConfig {
        const {intervalMs, limit = DEFAULT_LIMIT, parallel = 1, maxExtraRuns = 0, checkEveryMs, settings} = this.job.config
        const live = settings?.get()
        const interval = live?.intervalMs ?? intervalMs
        return {
            enabled: live?.enabled ?? true,
            intervalMs: interval,
            limit: live?.limit ?? limit,
            parallel: live?.parallel ?? parallel,
            maxExtraRuns: live?.maxExtraRuns ?? maxExtraRuns,
            checkEveryMs: Math.min(interval, checkEveryMs ?? Math.max(MIN_CHECK_EVERY_MS, Math.min(interval / 10, MAX_CHECK_EVERY_MS))),
        }
    }

    private tick(): void {
        if (this.stopped.signal.aborted) return
        const config = this.runConfig()
        if (config.enabled && !this.running) {
            this.running = this.runOnce(config)
                .catch(err => GGLog.error(this.job, "Job run failed", {job: this.job.config.name, err: (err as Error).message}))
                .finally(() => { this.running = undefined })
        }
        this.schedule(this.job.config.lock === "exclusive" ? config.checkEveryMs : config.intervalMs)
    }

    private async runOnce(config: RunConfig): Promise<void> {
        const {name, lock, timeoutMs} = this.job.config
        const signal = this.stopped.signal
        const startedAt = Date.now()
        const overdue = this.runner.scope.setTimeout(() => {
            GGLog.warn(this.job, "Job still running past its timeout", {job: name, timeoutMs})
        }, timeoutMs)
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
            if (lock === "exclusive") {
                // A tenth of a check of slack, for clock skew between instances: a check that finds the run a moment
                // short of due must not push it a whole check back.
                const due = {lastRunAtMost: startedAt - config.intervalMs + config.checkEveryMs / 10, ranAt: startedAt}
                await this.withLock(name, signal, s => {
                    GGLog.info(this.job, "Job run", {job: name, owner: this.runner.owner})
                    return run(s)
                }, due)
            } else {
                await run(signal)
            }
        } finally {
            clearTimeout(overdue)
        }
    }

    /**
     * Lost-lock and stop both abort `fn`'s signal. A lock is lost when a renew fails, or when the last renew that
     * succeeded was sent two thirds of a TTL ago: the next tick would come too late. A lost lock is never released.
     */
    private async withLock(
        id: string,
        parent: AbortSignal,
        fn: (signal: AbortSignal) => Promise<void>,
        due?: {lastRunAtMost: number, ranAt: number},
    ): Promise<"OK" | "SKIPPED" | "LOST"> {
        const {lock, owner, scope} = this.runner
        const {name, timeoutMs: ttl} = this.job.config
        let renewedAt = Date.now()
        if (!await lock.acquire(id, owner, ttl, due?.lastRunAtMost)) return "SKIPPED"
        const lost = new AbortController()
        let done = false
        const lose = () => {
            if (done || lost.signal.aborted) return
            GGLog.warn(this.job, "Lost job lock, aborting", {job: name, id})
            metric(() => GGJobMetrics.lockLost.inc(1, {job: name}))
            lost.abort()
            clearInterval(heartbeat)
        }
        const heartbeat = scope.setInterval(() => {
            const sentAt = Date.now()
            if (sentAt - renewedAt >= ttl * 2 / 3) return lose()
            lock.renew(id, owner, ttl).then(ok => {
                if (ok) renewedAt = Math.max(renewedAt, sentAt)
                else lose()
            }, err => GGLog.warn(this.job, "Job lock heartbeat failed", {job: name, id, err: (err as Error).message}))
        }, ttl / 3)
        heartbeat.unref()
        let completed = false
        try {
            await fn(AbortSignal.any([parent, lost.signal]))
            completed = true
        } finally {
            done = true
            clearInterval(heartbeat)
            if (!lost.signal.aborted) {
                // A run that was interrupted or threw records no last run, so it is picked up again at the next check.
                await lock.release(id, owner, completed && !parent.aborted ? due?.ranAt : undefined)
                    .catch(err => GGLog.warn(this.job, "Job lock release failed", {job: name, id, err: (err as Error).message}))
            }
        }
        return lost.signal.aborted ? "LOST" : "OK"
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
            let skipped = 0
            const worker = async () => {
                while (next < rows.length && !signal.aborted) {
                    const result = await this.runRow(rows[next++], signal)
                    if (result === "ERROR") failed++
                    else if (result === "SKIPPED") skipped++
                }
            }
            await Promise.all(Array.from({length: Math.min(parallel, rows.length)}, worker))

            const report = {rows: rows.length, failed, skipped, durationMs: Date.now() - startedAt}
            if (rows.length > 0) GGLog.info(this.job, "Job batch done", {job: name, ...report})
            await this.job.dataSetFinished?.(report)
                .catch(err => GGLog.warn(this.job, "Job dataSetFinished failed", {job: name, err: (err as Error).message}))
            // A batch of rows all locked by other instances made no progress; the next one would read them again.
            if (signal.aborted || failed > 0 || skipped === rows.length || rows.length < limit || extra >= maxExtraRuns) return
        }
    }

    private async runRow(row: unknown, signal: AbortSignal): Promise<"OK" | "ERROR" | "SKIPPED"> {
        const job = this.job.config.name
        metric(() => GGJobMetrics.rowsInFlight.inc(1, {job}))
        try {
            if (this.job.config.lock === "item") {
                const result = await this.withLock(`${job}#${this.job.rowKey!(row)}`, signal, s => this.job.processRow(row, s))
                if (result === "SKIPPED") return result
                if (result === "LOST") throw new Error("Lost the row's lock")
            } else {
                await this.job.processRow(row, signal)
            }
            metric(() => GGJobMetrics.rows.inc(1, {job, result: "OK"}))
            return "OK"
        } catch (err) {
            metric(() => GGJobMetrics.rows.inc(1, {job, result: "ERROR"}))
            GGLog.warn(this.job, "Job row failed", {job, row: this.describe(row), err: (err as Error).message})
            return "ERROR"
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
