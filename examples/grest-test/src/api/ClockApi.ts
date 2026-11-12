import {GGHttpSchema, GGRpc} from "@grest-ts/http"
import {GGContractClass, IsArray, IsBoolean, IsLiteral, IsNumber, IsObject, IsString, IsUint, SERVER_ERROR} from "@grest-ts/schema"

export const IsClockReading = IsObject({
    now: IsNumber,
    newDate: IsNumber,
    fixed: IsNumber,
    isDate: IsBoolean,
})
export type ClockReading = typeof IsClockReading.infer

export const IsScheduleTimer = IsObject({
    id: IsString,
    ms: IsUint,
    interval: IsBoolean.orUndefined,
    /** The callback returns a promise that settles this much real time later. */
    asyncMs: IsUint.orUndefined,
    fail: IsBoolean.orUndefined,
    /** The callback schedules `<id>:nested` with the same delay, or `nestedMs`. */
    nested: IsBoolean.orUndefined,
    nestedMs: IsUint.orUndefined,
    /** The callback refreshes this other timer. */
    refreshes: IsString.orUndefined,
})
export type ScheduleTimer = typeof IsScheduleTimer.infer

function clockApi(name: string) {
    return new GGHttpSchema({
        contract: new GGContractClass(`Clock${name}`, {
            read: {
                success: IsClockReading,
                errors: [SERVER_ERROR],
            },
            schedule: {
                input: IsScheduleTimer,
                errors: [SERVER_ERROR],
            },
            rawTimer: {
                input: IsObject({id: IsString, ms: IsUint}),
                errors: [SERVER_ERROR],
            },
            cancel: {
                input: IsObject({id: IsString, by: IsLiteral("handle", "id", "close").orUndefined}),
                errors: [SERVER_ERROR],
            },
            refresh: {
                input: IsObject({id: IsString}),
                errors: [SERVER_ERROR],
            },
            fired: {
                success: IsArray(IsString),
                errors: [SERVER_ERROR],
            },
            reset: {
                errors: [SERVER_ERROR],
            },
        }),
        pathPrefix: `api/clock-${name.toLowerCase()}`,
        routes: {
            read: GGRpc.GET("read"),
            schedule: GGRpc.POST("schedule"),
            rawTimer: GGRpc.POST("raw-timer"),
            cancel: GGRpc.POST("cancel"),
            refresh: GGRpc.POST("refresh"),
            fired: GGRpc.GET("fired"),
            reset: GGRpc.POST("reset"),
        },
    })
}

export const ClockInlineApi = clockApi("Inline")
export const ClockWorkerApi = clockApi("Worker")
export const ClockIsolatedApi = clockApi("Isolated")
export const ClockLateApi = clockApi("Late")
