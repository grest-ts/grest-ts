import {GGRpc, httpSchema} from "@grest-ts/http"
import {FORBIDDEN, GGContractClass, IsObject, IsString, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";
import {GG_USER_AUTH_TOKEN} from "./auth/UserAuth";

const IsUserId = IsString.brand("UserId")

export const IsChangePasswordRequest = IsObject({
    oldPassword: IsString.nonEmpty,
    newPassword: IsString.nonEmpty
})
export type ChangePasswordRequest = typeof IsChangePasswordRequest.infer

export const IsUser = IsObject({
    id: IsUserId,
    username: IsString,
    email: IsString
})

export const UserAuthApiContract = new GGContractClass("UserAuthApi", {
    changePassword: {
        input: IsChangePasswordRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR]
    },
    me: {
        success: IsUser,
        errors: [NOT_FOUND, NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR]
    }
})

export const UserAuthApi = httpSchema(UserAuthApiContract)
    .pathPrefix("api/users")
    .use(GG_USER_AUTH_TOKEN)
    .routes({
        changePassword: GGRpc.POST("changePassword"),
        me: GGRpc.GET("me")
    })
