import {GGContractClass, IsObject, IsString, IsArray, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema"
import {GGRpc, httpSchema} from "@grest-ts/http"
import {INVALID_CREDENTIALS, UNAUTHORIZED, NOT_FOUND} from "./errors"
import {IsUser, IsOrganization, IsOrgId} from "./schemas"
import {GG_USER_TOKEN, GG_ORG_TOKEN} from "../auth/AuthContext"

const IsLoginRequest = IsObject({
    username: IsString,
    password: IsString,
})

const IsLoginResponse = IsObject({
    userToken: IsString,
    user: IsUser,
})

const IsSelectOrgRequest = IsObject({
    orgId: IsOrgId,
})

const IsSelectOrgResponse = IsObject({
    orgToken: IsString,
    org: IsOrganization,
})

const IsRefreshTokenResponse = IsObject({
    userToken: IsString,
})

const IsRefreshOrgTokenResponse = IsObject({
    orgToken: IsString,
})

const IsMeResponse = IsObject({
    user: IsUser,
    org: IsOrganization.orUndefined,
})

export const AuthApiContract = new GGContractClass("AuthApi", {
    login: {
        input: IsLoginRequest,
        success: IsLoginResponse,
        errors: [INVALID_CREDENTIALS, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    listOrgs: {
        success: IsArray(IsOrganization),
        errors: [UNAUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    selectOrg: {
        input: IsSelectOrgRequest,
        success: IsSelectOrgResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    refreshUserToken: {
        success: IsRefreshTokenResponse,
        errors: [UNAUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    refreshOrgToken: {
        success: IsRefreshOrgTokenResponse,
        errors: [UNAUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    me: {
        success: IsMeResponse,
        errors: [UNAUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
})

// Login has no auth. listOrgs/selectOrg/refreshUserToken/me need user token only.
// refreshOrgToken needs both user token and org token.
export const AuthApi = httpSchema(AuthApiContract)
    .pathPrefix("api/auth")
    .use(GG_USER_TOKEN)
    .use(GG_ORG_TOKEN)
    .routes({
        login: GGRpc.POST("login"),
        listOrgs: GGRpc.GET("orgs"),
        selectOrg: GGRpc.POST("select-org"),
        refreshUserToken: GGRpc.POST("refresh-user"),
        refreshOrgToken: GGRpc.POST("refresh-org"),
        me: GGRpc.GET("me"),
    })
