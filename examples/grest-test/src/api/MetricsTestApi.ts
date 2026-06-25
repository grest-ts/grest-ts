import {GGRpc, GGHttpSchema} from "@grest-ts/http"
import {GGContractClass, IsBoolean, IsNumber, IsObject, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";

// ---------------------------------------------------------
// Type Schemas
// ---------------------------------------------------------

export const IsMetricsResponse = IsObject({
    success: IsBoolean,
    counterValue: IsNumber,
    gaugeValue: IsNumber,
    histogramCount: IsNumber
})
export type MetricsResponse = typeof IsMetricsResponse.infer

export const IsIncrementRequest = IsObject({
    amount: IsNumber.orUndefined
})
export type IncrementRequest = typeof IsIncrementRequest.infer

export const IsSetGaugeRequest = IsObject({
    value: IsNumber
})
export type SetGaugeRequest = typeof IsSetGaugeRequest.infer

export const IsRecordDurationRequest = IsObject({
    durationMs: IsNumber
})
export type RecordDurationRequest = typeof IsRecordDurationRequest.infer

export const IsResetResponse = IsObject({
    reset: IsBoolean
})
export type ResetResponse = typeof IsResetResponse.infer

// ---------------------------------------------------------
// Contract & API Interface
// ---------------------------------------------------------

export const MetricsTestApiContract = new GGContractClass("MetricsTestApi", {
    getMetrics: {
        success: IsMetricsResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    incrementCounter: {
        input: IsIncrementRequest,
        success: IsMetricsResponse,
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    setGauge: {
        input: IsSetGaugeRequest,
        success: IsMetricsResponse,
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    recordDuration: {
        input: IsRecordDurationRequest,
        success: IsMetricsResponse,
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    resetMetrics: {
        success: IsResetResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

export const MetricsTestApi = new GGHttpSchema({
    contract: MetricsTestApiContract,
    pathPrefix: "api/metrics-test",
    routes: {
        getMetrics: GGRpc.GET("metrics"),
        incrementCounter: GGRpc.POST("counter/increment"),
        setGauge: GGRpc.POST("gauge/set"),
        recordDuration: GGRpc.POST("histogram/record"),
        resetMetrics: GGRpc.POST("reset")
    },
})
