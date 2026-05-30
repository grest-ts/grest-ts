import {GGRpc, httpSchema} from "@grest-ts/http"
import {ERROR, EXISTS, GGContractClass, IsEmail, IsObject, IsString, NOT_AUTHORIZED, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS} from "@grest-ts/schema"
import {IsGGAuthTokensResult} from "@grest-ts/auth"

const IsUserId = IsString.brand("UserId")

export const IsUser = IsObject({
    id: IsUserId,
    username: IsString,
    email: IsString,
})

export const IsRegisterRequest = IsObject({
    username: IsString.minLength(3).maxLength(20).docs({title: "Username", example: "alice"}),
    email: IsEmail.docs({title: "Email address", example: "alice@example.com"}),
    password: IsString.nonEmpty.docs({title: "Password", example: "secret123"}),
})
export type RegisterRequest = typeof IsRegisterRequest.infer

export const IsLoginRequest = IsObject({
    username: IsString.docs({title: "Username", example: "alice"}),
    password: IsString.docs({title: "Password", example: "secret123"}),
})
export type LoginRequest = typeof IsLoginRequest.infer

export const IsTokenPairResponse = IsGGAuthTokensResult
export type TokenPairResponse = typeof IsTokenPairResponse.infer

export const IsAuthResponse = IsTokenPairResponse.extend({
    data: IsUser,
})
export type AuthResponse = typeof IsAuthResponse.infer

export const IsRefreshRequest = IsObject({
    refreshToken: IsString.docs({title: "JWT refresh token"}),
})
export type RefreshRequest = typeof IsRefreshRequest.infer

export const InvalidCredentialsError = ERROR.badRequest("INVALID_CREDENTIALS")

export const AuthPublicApiContract = new GGContractClass("AuthPublicApi", {
    register: {
        input: IsRegisterRequest,
        success: IsAuthResponse,
        errors: [EXISTS, InvalidCredentialsError, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
    login: {
        input: IsLoginRequest,
        success: IsAuthResponse,
        errors: [InvalidCredentialsError, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
    refresh: {
        input: IsRefreshRequest,
        success: IsTokenPairResponse,
        errors: [NOT_AUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
})

export const AuthPublicApi = httpSchema(AuthPublicApiContract)
    .pathPrefix("pub/auth")
    .routes({
        register: GGRpc.POST("register"),
        login: GGRpc.POST("login"),
        refresh: GGRpc.POST("refresh"),
    })
