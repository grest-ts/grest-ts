import {GGRpc, GGHttpSchema} from "@grest-ts/http"
import {GGContractClass, IsEmail, IsObject, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS} from "@grest-ts/schema"
import {USER_TOKEN_WIRE, IsUser} from "./auth/UserAuth"

export const IsUpdateProfileRequest = IsObject({
    email: IsEmail.orUndefined.docs({title: "New email address", example: "newalice@example.com"}),
})
export type UpdateProfileRequest = typeof IsUpdateProfileRequest.infer

export const UserApiContract = new GGContractClass("UserApi", {
    me: {
        success: IsUser,
        errors: [NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
    updateProfile: {
        input: IsUpdateProfileRequest,
        success: IsUser,
        errors: [NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
})

export const UserApi = new GGHttpSchema({
    contract: UserApiContract,
    pathPrefix: "api/users",
    use: [USER_TOKEN_WIRE],
    routes: {
        me: GGRpc.GET("me"),
        updateProfile: GGRpc.PUT("profile"),
    }
})
