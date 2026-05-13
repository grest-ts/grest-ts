import {GGRpc, httpSchema} from "@grest-ts/http"
import {ERROR, EXISTS, FORBIDDEN, GGContractClass, IsEmail, IsObject, IsString, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";

const IsUserId = IsString.brand("UserId")

const IsUserAuthToken = IsString.brand("UserAuthToken")

export const IsUser = IsObject({
    id: IsUserId,
    username: IsString,
    email: IsString
})

export const IsRegisterRequest = IsObject({
    username: IsString.minLength(3).maxLength(10),
    email: IsEmail,
    password: IsString.nonEmpty
})
export type RegisterRequest = typeof IsRegisterRequest.infer

export const IsLoginRequest = IsObject({
    username: IsString,
    password: IsString
})
export type LoginRequest = typeof IsLoginRequest.infer

export const IsLoginResponse = IsObject({
    token: IsUserAuthToken,
    user: IsUser
})
export type LoginResponse = typeof IsLoginResponse.infer

export const BadUsernameError = ERROR.badRequest("BAD_USERNAME", IsObject({reason: IsString.nonEmpty}))

export const InvalidCredentialsError = ERROR.badRequest("INVALID_CREDENTIALS")

export const UserPublicApiContract = new GGContractClass("UserPublicApi", {
    register: {
        input: IsRegisterRequest,
        success: IsLoginResponse,
        errors: [EXISTS, FORBIDDEN, BadUsernameError, InvalidCredentialsError, SERVER_ERROR, VALIDATION_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    login: {
        input: IsLoginRequest,
        success: IsLoginResponse,
        errors: [FORBIDDEN, InvalidCredentialsError, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

export const UserPublicApi = httpSchema(UserPublicApiContract)
    .pathPrefix("pub/users")
    .routes({
        register: GGRpc.POST("register"),
        login: GGRpc.POST("login")
    })

