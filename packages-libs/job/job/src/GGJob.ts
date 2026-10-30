import type {GGSetting} from "@grest-ts/config"
import type {GGJobSettings} from "./GGJobSettings"

/**
 * - `exclusive`: one instance at a time runs the whole job, at most once per interval across all instances.
 * - `item`: every instance runs the job; each row is locked (by `rowKey`) before `processRow`. `getDataSet` must
 *   drain itself — a processed row must drop out of it — and `processRow` must re-check its row under the lock:
 *   it was read before another instance may have finished it.
 * - `none`: every instance runs the job and `processRow` guards its own rows.
 */
export type GGJobLockMode = "exclusive" | "item" | "none"

export interface GGJobConfig {
    /** Stable across deployments: it is the lock id. */
    name: string
    lock: GGJobLockMode
    intervalMs: number
    /** Lock TTL — a crashed holder's lock frees after this. Renewed while the run (or row) is alive. Also the
     *  duration after which a still-running run is reported. */
    timeoutMs: number
    /** Default 500. */
    limit?: number
    /** Rows processed concurrently. Default 1. */
    parallel?: number
    /** Further batches in the same run while a batch comes back full (rows.length === limit). Default 0. */
    maxExtraRuns?: number
    /** Default 1–2 s, jittered. */
    startupDelayMs?: number
    /** How often an `exclusive` job asks whether it is due. Default intervalMs / 10, within 60 s–15 min (never above intervalMs). */
    checkEveryMs?: number
    /** Live overrides of the fields above, read at the start of every run. */
    settings?: GGSetting<GGJobSettings>
}

export interface GGJobReport {
    rows: number
    failed: number
    durationMs: number
}

export abstract class GGJob<Row> {

    readonly config: GGJobConfig

    protected constructor(config: GGJobConfig) {
        this.config = config
    }

    abstract getDataSet(limit: number): Promise<Row[]>

    /** `signal` aborts when the run lost its lock or the runner is stopping; rows not yet started are skipped. */
    abstract processRow(row: Row, signal: AbortSignal): Promise<void>

    /** Required for `item` mode. */
    rowKey?(row: Row): string

    /** After every batch whose data set loaded. */
    dataSetFinished?(report: GGJobReport): Promise<void>

    /** What a failed row logs as. */
    describeRow(row: Row): unknown {
        return this.rowKey ? this.rowKey(row) : row
    }
}
