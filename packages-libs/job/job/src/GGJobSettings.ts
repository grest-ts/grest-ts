import {IsBoolean, IsNumber, IsObject} from "@grest-ts/schema"

export const IsGGJobSettings = IsObject({
    intervalMs: IsNumber.min(1).multipleOf(1),
    /** Lock TTL; a run past it is logged, not stopped. */
    timeoutMs: IsNumber.min(1).multipleOf(1),
    enabled: IsBoolean.orUndefined,
    limit: IsNumber.min(1).multipleOf(1).orUndefined,
    parallel: IsNumber.min(1).multipleOf(1).orUndefined,
    maxExtraRuns: IsNumber.min(0).multipleOf(1).orUndefined,
    checkEveryMs: IsNumber.min(1).multipleOf(1).orUndefined,
    startupDelayMs: IsNumber.min(0).multipleOf(1).orUndefined,
})
export type GGJobSettings = typeof IsGGJobSettings.infer
