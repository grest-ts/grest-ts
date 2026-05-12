import {GGRpc, httpSchema} from "@grest-ts/http"
import {GGContractClass, GGContractImplementation, IsBoolean, IsNumber, IsObject, IsString, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {IsTestObjectSettings} from "../MainConfig.api";

// ---------------------------------------------------------
// Type Schemas
// ---------------------------------------------------------

export const IsConfigTestResponse = IsObject({
    watchedTimeout: IsNumber
})
export type ConfigTestResponse = typeof IsConfigTestResponse.infer

export const IsObjectConfigResponse = IsObject({
    objectConfig: IsTestObjectSettings
})
export type ObjectConfigResponse = typeof IsObjectConfigResponse.infer

export const IsLogRequest = IsObject({
    message: IsString
})
export type LogRequest = typeof IsLogRequest.infer

export const IsLogResponse = IsObject({
    logged: IsBoolean,
    message: IsString
})
export type LogResponse = typeof IsLogResponse.infer

export const IsDelayedLogRequest = IsObject({
    message: IsString,
    delayMs: IsNumber
})
export type DelayedLogRequest = typeof IsDelayedLogRequest.infer

// ---------------------------------------------------------
// Contract & API Interface
// ---------------------------------------------------------

export const ConfigTestApiContract = new GGContractClass("ConfigTestApi", {
    getWatchedValue: {
        success: IsConfigTestResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    getObjectConfig: {
        success: IsObjectConfigResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    logMessage: {
        input: IsLogRequest,
        success: IsLogResponse,
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    logDelayed: {
        input: IsDelayedLogRequest,
        success: undefined as undefined,
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

export type IConfigTestApi = GGContractImplementation<typeof ConfigTestApiContract["methods"]>

export const ConfigTestApi = httpSchema(ConfigTestApiContract)
    .pathPrefix("api/config-test")
    .routes({
        getWatchedValue: GGRpc.GET("watched-value"),
        getObjectConfig: GGRpc.GET("object-config"),
        logMessage: GGRpc.POST("log"),
        logDelayed: GGRpc.POST("log-delayed")
    })
