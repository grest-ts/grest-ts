import {GGRpc, httpSchema} from "@grest-ts/http"
import {GGContractClass, IsObject, IsString, IsNumber, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema"

export const IsHealthResponse = IsObject({
    status: IsString,
    version: IsString,
    activeSessions: IsNumber,
    uptime: IsNumber,
    idleSeconds: IsNumber,
})

export type HealthResponse = typeof IsHealthResponse.infer

export const HealthApiContract = new GGContractClass("HealthApi", {
    health: {
        success: IsHealthResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

export const HealthApi = httpSchema(HealthApiContract)
    .pathPrefix("api")
    .routes({
        health: GGRpc.GET("health"),
    })
