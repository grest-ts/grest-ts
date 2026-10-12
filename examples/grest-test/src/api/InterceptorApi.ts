import {GGRpc, GGHttpSchema} from "@grest-ts/http"
import {FORBIDDEN, GGContractClass, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"

declare module "@grest-ts/schema" {
    interface GGContractMethodMeta {
        upperCaseInput?: boolean
        deny?: boolean
    }
}

const IsText = IsObject({text: IsString})

export const InterceptorContract = new GGContractClass("InterceptorApi", {
    plain: {
        input: IsText,
        success: IsString,
        errors: [SERVER_ERROR],
    },
    shout: {
        input: IsText,
        success: IsString,
        errors: [SERVER_ERROR],
        meta: {upperCaseInput: true},
    },
    denied: {
        input: IsText,
        success: IsString,
        errors: [FORBIDDEN, SERVER_ERROR],
        meta: {deny: true},
    },
})

export const InterceptorApi = new GGHttpSchema({
    contract: InterceptorContract,
    pathPrefix: "api/interceptor",
    routes: {
        plain: GGRpc.POST("plain"),
        shout: GGRpc.POST("shout"),
        denied: GGRpc.POST("denied"),
    },
})
