import {GGHeader, GGHttpSchema, GGRpc} from "@grest-ts/http"
import {GG_NO_PERMISSIONS, GGContractClass, IsString, NOT_AUTHORIZED, SERVER_ERROR} from "@grest-ts/schema"

export const INTERNAL_SECRET_WIRE = new GGHeader("x-internal-secret")

export const SharedSecretApiContract = new GGContractClass("SharedSecretApi", {
    ping: {
        success: IsString,
        errors: [NOT_AUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
})

export const SharedSecretApi = new GGHttpSchema({
    contract: SharedSecretApiContract,
    pathPrefix: "internal/shared-secret",
    use: [INTERNAL_SECRET_WIRE],
    routes: {
        ping: GGRpc.GET("ping"),
    }
})

export const SharedSecretCallerApiContract = new GGContractClass("SharedSecretCallerApi", {
    withRightSecret: {
        success: IsString,
        errors: [NOT_AUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
    withWrongSecret: {
        success: IsString,
        errors: [NOT_AUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
})

export const SharedSecretCallerApi = new GGHttpSchema({
    contract: SharedSecretCallerApiContract,
    pathPrefix: "api/shared-secret-caller",
    routes: {
        withRightSecret: GGRpc.GET("right"),
        withWrongSecret: GGRpc.GET("wrong"),
    }
})
