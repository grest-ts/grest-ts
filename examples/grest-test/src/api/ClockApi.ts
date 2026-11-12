import {GGHttpSchema, GGRpc} from "@grest-ts/http"
import {GGContractClass, IsBoolean, IsNumber, IsObject, SERVER_ERROR} from "@grest-ts/schema"

export const IsClockReading = IsObject({
    now: IsNumber,
    newDate: IsNumber,
    fixed: IsNumber,
    isDate: IsBoolean,
})
export type ClockReading = typeof IsClockReading.infer

function clockApi(name: string) {
    return new GGHttpSchema({
        contract: new GGContractClass(`Clock${name}`, {
            read: {
                success: IsClockReading,
                errors: [SERVER_ERROR],
            },
        }),
        pathPrefix: `api/clock-${name.toLowerCase()}`,
        routes: {
            read: GGRpc.GET("read"),
        },
    })
}

export const ClockInlineApi = clockApi("Inline")
export const ClockWorkerApi = clockApi("Worker")
export const ClockIsolatedApi = clockApi("Isolated")
export const ClockLateApi = clockApi("Late")
