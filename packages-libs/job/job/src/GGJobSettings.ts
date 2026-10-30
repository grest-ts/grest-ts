import {IsBoolean, IsNumber, IsObject} from "@grest-ts/schema"

/** A job's schedule and tuning: the schema of the `GGSetting` in `GGJobConfig.settings`. */
export const IsGGJobSettings = IsObject({
    intervalMs: IsNumber.min(1),
    /** Lock TTL, renewed while a run is alive; also when a still-running run is reported. */
    timeoutMs: IsNumber.min(1),
    /** `false` skips every run until it is set back. Default true. */
    enabled: IsBoolean.orUndefined,
    /** Rows per batch, passed to `getDataSet`. Default 500. */
    limit: IsNumber.min(1).orUndefined,
    /** Rows processed concurrently. Default 1. */
    parallel: IsNumber.min(1).orUndefined,
    /** Further batches in the same run while a batch comes back full. Default 0. */
    maxExtraRuns: IsNumber.min(0).orUndefined,
    /** How often a `oneInstance` job checks whether it is due. Default intervalMs / 10, within 60 s–15 min. */
    checkEveryMs: IsNumber.min(1).orUndefined,
    /** Delay before the first run. Default 1–2 s, jittered. */
    startupDelayMs: IsNumber.min(0).orUndefined,
})
export type GGJobSettings = typeof IsGGJobSettings.infer
