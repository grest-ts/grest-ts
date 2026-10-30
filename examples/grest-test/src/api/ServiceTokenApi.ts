import {GGHeader, GGHttpSchema, GGRpc} from "@grest-ts/http"
import {GG_NO_PERMISSIONS, GGContractClass, IsString, NOT_AUTHORIZED, SERVER_ERROR} from "@grest-ts/schema"

export const SERVICE_TOKEN_WIRE = new GGHeader("authorization", {scheme: "bearer"})

export const ServiceTokenApiContract = new GGContractClass("ServiceTokenApi", {
    whoami: {
        success: IsString,
        errors: [NOT_AUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
})

export const ServiceTokenApi = new GGHttpSchema({
    contract: ServiceTokenApiContract,
    pathPrefix: "internal/service-token",
    use: [SERVICE_TOKEN_WIRE],
    routes: {
        whoami: GGRpc.GET("whoami"),
    }
})

export const ServiceTokenCallerApiContract = new GGContractClass("ServiceTokenCallerApi", {
    callTarget: {
        success: IsString,
        errors: [NOT_AUTHORIZED, SERVER_ERROR],
    },
})

export const ServiceTokenCallerApi = new GGHttpSchema({
    contract: ServiceTokenCallerApiContract,
    pathPrefix: "api/service-token-caller",
    routes: {
        callTarget: GGRpc.GET("call-target"),
    }
})
