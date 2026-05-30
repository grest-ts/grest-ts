import {GGRpc, httpSchema} from "@grest-ts/http"
import {ERROR, EXISTS, GGContractClass, IsEmail, IsObject, IsString, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS} from "@grest-ts/schema"

const IsUserId = IsString.brand("UserId")
const IsUserAuthToken = IsString.brand("UserAuthToken")

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

export const IsAuthResponse = IsObject({
    token: IsUserAuthToken,
    user: IsUser,
})
export type AuthResponse = typeof IsAuthResponse.infer

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
})

export const AuthPublicApi = httpSchema(AuthPublicApiContract)
    .pathPrefix("pub/auth")
    .routes({
        register: GGRpc.POST("register"),
        login: GGRpc.POST("login"),
    })
