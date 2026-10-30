import {GGHeader, GGHttpSchema, GGRpc} from "@grest-ts/http"
import {FORBIDDEN, GG_NO_PERMISSIONS, GGContractClass, IsObject, IsRecord, IsString, NOT_AUTHORIZED, SERVER_ERROR} from "@grest-ts/schema"
import {IsGGAccessTokenData} from "@grest-ts/auth"

// `Basic base64(clientId:secret)` of a registered service client (GGOAuthServer serviceClients).
export const GG_OAUTH_SERVICE_CLIENT = new GGHeader("authorization")

// What the authorization server offers the app's own backends. FORBIDDEN: the resource isn't theirs,
// or there is no token for this subject (an invalid subject token, or claims answered undefined).
export const GGOAuthServiceApiContract = new GGContractClass("GGOAuthServiceApi", {
    token: {
        input: IsObject({resource: IsString}),
        success: IsGGAccessTokenData,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
    exchange: {
        input: IsObject({subjectToken: IsString, resource: IsString, params: IsRecord(IsString, IsString)}),
        success: IsGGAccessTokenData,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
})

export const GGOAuthServiceApi = new GGHttpSchema({
    contract: GGOAuthServiceApiContract,
    pathPrefix: "oauth-service",
    use: [GG_OAUTH_SERVICE_CLIENT],
    routes: {
        token: GGRpc.POST("token"),
        exchange: GGRpc.POST("exchange"),
    },
})
