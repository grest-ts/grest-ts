import {hostname} from "node:os"
import {randomUUID} from "node:crypto"
import {GGLocator, GGLocatorKey, GGLocatorServiceType, type GGLocatorScope} from "@grest-ts/locator"
import {GGLog} from "@grest-ts/logger"
import {GG_METRICS} from "@grest-ts/metrics"
import type {GGJob, GGJobConfig} from "./GGJob"
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
    now?: () => number
}

/** Runs its jobs from runtime start until teardown, which stops new rows, waits for running ones and frees locks. */
export class GGJobRunner {

    readonly owner: string
    readonly lock: GGJobLock
    readonly now: () => number
    readonly scope: GGLocatorScope

    private readonly loops: JobLoop[] = []
    private started = false

    constructor(options: GGJobRunnerOptions) {
        this.owner = options.owner ?? `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`
        this.lock = options.lock
        this.now = options.now ?? Date.now
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
            if (this.started) loop.start()
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
        await Promise.all(this.loops.map(l => l.stop()))
    }
}

type RunConfig = Required<Pick<GGJobConfig, "intervalMs" | "limit" | "parallel" | "maxExtraRuns">> & {enabled: boolean}

class JobLoop {

    readonly job: GGJob<unknown>
    private readonly runner: GGJobRunner
    private timer?: NodeJS.Timeout
    private running?: Promise<void>
    private abort?: AbortController
    private stopping = false

    constructor(job: GGJob<unknown>, runner: GGJobRunner) {
        this.job = job
        this.runner = runner
    }

    start(): void {
        this.schedule(this.job.config.startupDelayMs ?? 1_000 + Math.random() * 1_000)
    }

    async stop(): Promise<void> {
        this.stopping = true
        clearTimeout(this.timer)
        this.abort?.abort()
        await this.running
    }

    private schedule(ms: number): void {
        this.timer = this.runner.scope.setTimeout(() => this.tick(), ms)
        this.timer.unref()
    }

    private runConfig(): RunConfig {
        const {intervalMs, limit = DEFAULT_LIMIT, parallel = 1, maxExtraRuns = 0, settings} = this.job.config
        const live = Object.fromEntries(Object.entries(settings?.get() ?? {}).filter(([, v]) => v !== undefined))
        return {enabled: true, intervalMs, limit, parallel, maxExtraRuns, ...live}
    }

    private tick(): void {
        if (this.stopping) return
        const config = this.runConfig()
        if (config.enabled && !this.running) {
            this.running = this.runOnce(config)
                .catch(err => GGLog.error(this.job, "Job run failed", {job: this.job.config.name, err: (err as Error).message}))
                .finally(() => { this.running = undefined })
        }
        this.schedule(this.job.config.lock === "exclusive" ? this.checkEveryMs(config) : config.intervalMs)
    }

    private checkEveryMs({intervalMs}: RunConfig): number {
        return this.job.config.checkEveryMs ?? Math.min(intervalMs, Math.max(MIN_CHECK_EVERY_MS, Math.min(intervalMs / 10, MAX_CHECK_EVERY_MS)))
    }

    private async runOnce(config: RunConfig): Promise<void> {
        const {name, lock, timeoutMs} = this.job.config
        this.abort = new AbortController()
        const signal = this.abort.signal
        const startedAt = this.runner.now()
        const overdue = this.runner.scope.setTimeout(() => {
            GGLog.warn(this.job, "Job still running past its timeout", {job: name, timeoutMs})
        }, timeoutMs)
        overdue.unref()
        try {
            if (lock === "exclusive") {
                // Half a check of slack: a timer firing a few ms early must not push the run a whole interval back.
                const ran = await this.withLock(name, signal, s => {
                    GGLog.info(this.job, "Job run", {job: name, owner: this.runner.owner})
                    metric(() => GGJobMetrics.runs.inc(1, {job: name}))
                    return this.runBatches(config, s)
                }, {lastRunAtMost: startedAt - config.intervalMs + this.checkEveryMs(config) / 2, ranAt: startedAt})
                if (!ran) return
            } else {
                metric(() => GGJobMetrics.runs.inc(1, {job: name}))
                await this.runBatches(config, signal)
            }
        } finally {
            clearTimeout(overdue)
        }
        const durationMs = this.runner.now() - startedAt
        metric(() => GGJobMetrics.runDuration.inc(durationMs, {job: name}))
        if (durationMs > config.intervalMs * WARN_RATIO) GGLog.warn(this.job, "Job run took most of its interval", {job: name, durationMs, intervalMs: config.intervalMs})
    }

    /** Lost-lock and stop both abort `fn`'s signal. A lost lock is never released: someone else holds it. */
    private async withLock(
        id: string,
        parent: AbortSignal,
        fn: (signal: AbortSignal) => Promise<void>,
        due?: {lastRunAtMost: number, ranAt: number},
    ): Promise<boolean> {
        const {lock, owner, scope} = this.runner
        const {name, timeoutMs: ttl} = this.job.config
        if (!await lock.acquire(id, owner, ttl, due?.lastRunAtMost)) return false
        const lost = new AbortController()
        const heartbeat = scope.setInterval(() => {
            lock.renew(id, owner, ttl).then(ok => {
                if (ok || lost.signal.aborted) return
                GGLog.warn(this.job, "Lost job lock, aborting", {job: name, id})
                metric(() => GGJobMetrics.lockLost.inc(1, {job: name}))
                lost.abort()
                clearInterval(heartbeat)
            }, err => GGLog.warn(this.job, "Job lock heartbeat failed", {job: name, id, err: (err as Error).message}))
        }, ttl / 3)
        heartbeat.unref()
        try {
            await fn(AbortSignal.any([parent, lost.signal]))
        } finally {
            clearInterval(heartbeat)
            if (!lost.signal.aborted) {
                // An interrupted run records no last run, so another instance picks it up straight away.
                await lock.release(id, owner, parent.aborted ? undefined : due?.ranAt)
                    .catch(err => GGLog.warn(this.job, "Job lock release failed", {job: name, id, err: (err as Error).message}))
            }
        }
        return true
    }

    private async runBatches({limit, parallel, maxExtraRuns}: RunConfig, signal: AbortSignal): Promise<void> {
        const name = this.job.config.name
        for (let extra = 0; ; extra++) {
            const startedAt = this.runner.now()
            let rows: unknown[]
            try {
                rows = await this.job.getDataSet(limit)
            } catch (err) {
                GGLog.warn(this.job, "Job data set failed to load", {job: name, err: (err as Error).message})
                return
            }
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

            const report = {rows: rows.length, failed, durationMs: this.runner.now() - startedAt}
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
            if (this.job.config.lock === "item") {
                await this.withLock(`${job}#${this.job.rowKey!(row)}`, signal, s => this.job.processRow(row, s))
            } else {
                await this.job.processRow(row, signal)
            }
            metric(() => GGJobMetrics.rows.inc(1, {job, result: "OK"}))
            return true
        } catch (err) {
            metric(() => GGJobMetrics.rows.inc(1, {job, result: "ERROR"}))
            GGLog.warn(this.job, "Job row failed", {job, row: this.job.describeRow(row), err: (err as Error).message})
            return false
        } finally {
            metric(() => GGJobMetrics.rowsInFlight.dec(1, {job}))
        }
    }
}

function metric(record: () => void): void {
    if (GG_METRICS.has()) record()
}
