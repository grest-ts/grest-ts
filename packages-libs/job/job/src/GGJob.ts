import type {GGSetting} from "@grest-ts/config"
import type {GGJobSettings} from "./GGJobSettings"

/** `oneInstance`: once per interval across all instances. `everyInstance`: each instance on its own schedule. */
export type GGJobRunOn = "oneInstance" | "everyInstance"

export interface GGJobConfig {
    /** Stable across deployments: it is the lock id. */
    name: string
    /** Default `oneInstance`. */
    runOn?: GGJobRunOn
    /** Read at the start of every run. */
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

    /** `signal` aborts when the lock is lost or the runner stops. */
    abstract processRow(row: Row, signal: AbortSignal): Promise<void>

    dataSetFinished?(report: GGJobReport): Promise<void>

    /** What a failed row logs as. */
    describeRow(row: Row): unknown {
        return row
    }
}
