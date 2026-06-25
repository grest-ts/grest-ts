import {GGRpc, GGHttpSchema} from "@grest-ts/http"
import {GGContractClass, IsBoolean, IsNumber, IsObject, IsString, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";

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
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    getNestedMetrics: {
        success: IsHttpMetricsResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    resetHttpMetrics: {
        success: IsHttpMetricsResetResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

export const HttpMetricsTestApi = new GGHttpSchema({
    contract: HttpMetricsTestApiContract,
    pathPrefix: "api/http-metrics-test",
    routes: {
        getHttpMetrics: GGRpc.GET("metrics"),
        getNestedMetrics: GGRpc.GET("nested"),
        resetHttpMetrics: GGRpc.POST("reset")
    },
})
