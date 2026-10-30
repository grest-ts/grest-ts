import {IsBoolean, IsObject, IsPosInt, IsUint} from "@grest-ts/schema"

/** Live overrides for a job, as the schema of a `GGSetting` passed in `GGJobConfig.settings`. */
export const IsGGJobSettings = IsObject({
    /** `false` skips every run until it is set back. */
    enabled: IsBoolean.orUndefined,
    intervalMs: IsPosInt.orUndefined,
    limit: IsPosInt.orUndefined,
    parallel: IsPosInt.orUndefined,
    maxExtraRuns: IsUint.orUndefined,
})
export type GGJobSettings = typeof IsGGJobSettings.infer
