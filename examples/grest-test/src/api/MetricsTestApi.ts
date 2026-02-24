import {GGRpc, httpSchema} from "@grest-ts/http"
import {GGContractClass, GGContractImplementation, IsBoolean, IsNumber, IsObject, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";

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
        errors: [SERVER_ERROR]
    },
    incrementCounter: {
        input: IsIncrementRequest,
        success: IsMetricsResponse,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    },
    setGauge: {
        input: IsSetGaugeRequest,
        success: IsMetricsResponse,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    },
    recordDuration: {
        input: IsRecordDurationRequest,
        success: IsMetricsResponse,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    },
    resetMetrics: {
        success: IsResetResponse,
        errors: [SERVER_ERROR]
    }
})

export type IMetricsTestApi = GGContractImplementation<typeof MetricsTestApiContract["methods"]>

export const MetricsTestApi = httpSchema(MetricsTestApiContract)
    .pathPrefix("api/metrics-test")
    .routes({
        getMetrics: GGRpc.GET("metrics"),
        incrementCounter: GGRpc.POST("counter/increment"),
        setGauge: GGRpc.POST("gauge/set"),
        recordDuration: GGRpc.POST("histogram/record"),
        resetMetrics: GGRpc.POST("reset")
    })
