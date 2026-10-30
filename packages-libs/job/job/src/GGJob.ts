import type {GGSetting} from "@grest-ts/config"
import type {GGJobSettings} from "./GGJobSettings"

/**
 * - `oneInstance`: one instance at a time runs the job, at most once per interval across all of them.
 * - `everyInstance`: every instance runs it, for work each one must do itself (e.g. warm a local cache).
 */
export type GGJobRunOn = "oneInstance" | "everyInstance"

export interface GGJobConfig {
    /** Stable across deployments: it is the lock id. */
    name: string
    /** Default `oneInstance`. */
    runOn?: GGJobRunOn
    /** Schedule and tuning, read at the start of every run: a `GGSetting` with the `IsGGJobSettings` schema. */
    settings: Pick<GGSetting<GGJobSettings>, "get">
}

export interface GGJobReport {
    rows: number
    failed: number
    durationMs: number
}

/** Every step must be safe to run twice: a run can overlap another when a lock is lost (see `withLock`). */
export abstract class GGJob<Row> {

    readonly config: GGJobConfig

    protected constructor(config: GGJobConfig) {
        this.config = config
    }

    abstract getDataSet(limit: number): Promise<Row[]>

    /** `signal` aborts when the run lost its lock or the runner is stopping; rows not yet started are skipped. */
    abstract processRow(row: Row, signal: AbortSignal): Promise<void>

    /** After every batch whose data set loaded. */
    dataSetFinished?(report: GGJobReport): Promise<void>

    /** What a failed row logs as. */
    describeRow(row: Row): unknown {
        return row
    }
}
