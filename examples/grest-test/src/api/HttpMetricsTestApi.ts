import {GGRpc, httpSchema} from "@grest-ts/http"
import {GGContractClass, GGContractImplementation, IsBoolean, IsNumber, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema";

// ---------------------------------------------------------
// Type Schemas
// ---------------------------------------------------------

export const IsHttpMetricsResponse = IsObject({
    timestamp: IsNumber,
    metricsJson: IsString
})
export type HttpMetricsResponse = typeof IsHttpMetricsResponse.infer

export const IsHttpMetricsResetResponse = IsObject({
    reset: IsBoolean
})
export type HttpMetricsResetResponse = typeof IsHttpMetricsResetResponse.infer

// ---------------------------------------------------------
// Contract & API Interface
// ---------------------------------------------------------

export const HttpMetricsTestApiContract = new GGContractClass("HttpMetricsTestApi", {
    getHttpMetrics: {
        success: IsHttpMetricsResponse,
        errors: [SERVER_ERROR]
    },
    getNestedMetrics: {
        success: IsHttpMetricsResponse,
        errors: [SERVER_ERROR]
    },
    resetHttpMetrics: {
        success: IsHttpMetricsResetResponse,
        errors: [SERVER_ERROR]
    }
})

export type IHttpMetricsTestApi = GGContractImplementation<typeof HttpMetricsTestApiContract["methods"]>

export const HttpMetricsTestApi = httpSchema(HttpMetricsTestApiContract)
    .pathPrefix("api/http-metrics-test")
    .routes({
        getHttpMetrics: GGRpc.GET("metrics"),
        getNestedMetrics: GGRpc.GET("nested"),
        resetHttpMetrics: GGRpc.POST("reset")
    })
