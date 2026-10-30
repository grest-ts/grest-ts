import {GGHeader, GGHttpSchema, GGRpc} from "@grest-ts/http"
import {ERROR, FORBIDDEN, GG_NO_PERMISSIONS, GGContractClass, IsObject, IsRecord, IsString, NOT_AUTHORIZED, SERVER_ERROR} from "@grest-ts/schema"
import {IsGGAccessTokenData} from "@grest-ts/auth"

// `Basic base64(clientId:secret)` of a registered service client (GGOAuthServer serviceClients).
export const GG_OAUTH_SERVICE_CLIENT = new GGHeader("authorization")

// The subject token given to exchange is invalid or expired: get a fresh one, it's not a refusal.
export const SUBJECT_TOKEN_INVALID = ERROR.define("SUBJECT_TOKEN_INVALID", 401)

// What the authorization server offers the app's own backends. NOT_AUTHORIZED: wrong client credentials.
// FORBIDDEN: the resource isn't the client's, or there is no token for this subject (claims answered undefined).
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
        errors: [NOT_AUTHORIZED, SUBJECT_TOKEN_INVALID, FORBIDDEN, SERVER_ERROR],
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
