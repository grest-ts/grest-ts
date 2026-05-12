import {GGContractClass, IsObject, IsString, IsArray, SERVER_ERROR } from "@grest-ts/schema"
import {GGRpc, httpSchema} from "@grest-ts/http"
import {UNAUTHORIZED, NOT_FOUND, ALREADY_EXISTS} from "./errors"
import {IsOrgUser, IsOrgUserId, IsUserId} from "./schemas"
import {GG_USER_TOKEN, GG_ORG_TOKEN} from "../auth/AuthContext"

const IsOrgUserIdRequest = IsObject({
    orgUserId: IsOrgUserId,
})

const IsAddOrgUserRequest = IsObject({
    userId: IsUserId,
    permissions: IsString,
})

const IsUpdateOrgUserRequest = IsObject({
    orgUserId: IsOrgUserId,
    permissions: IsString,
})

export const OrgUserApiContract = new GGContractClass("OrgUserApi", {
    get: {
        input: IsOrgUserIdRequest,
        success: IsOrgUser,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    list: {
        success: IsArray(IsOrgUser),
        errors: [UNAUTHORIZED, SERVER_ERROR],
    },
    add: {
        input: IsAddOrgUserRequest,
        success: IsOrgUser,
        errors: [UNAUTHORIZED, NOT_FOUND, ALREADY_EXISTS, SERVER_ERROR],
    },
    update: {
        input: IsUpdateOrgUserRequest,
        success: IsOrgUser,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    remove: {
        input: IsOrgUserIdRequest,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
})

export const OrgUserApi = httpSchema(OrgUserApiContract)
    .pathPrefix("api")
    .use(GG_USER_TOKEN)
    .use(GG_ORG_TOKEN)
    .routes({
        get: GGRpc.POST("org-users/get"),
        list: GGRpc.GET("org-users"),
        add: GGRpc.POST("org-users"),
        update: GGRpc.POST("org-users/update"),
        remove: GGRpc.POST("org-users/remove"),
    })
