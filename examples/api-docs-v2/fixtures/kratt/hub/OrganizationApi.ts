import {GGContractClass, IsArray, IsObject, IsString, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema"
import {GGRpc, httpSchema} from "@grest-ts/http"
import {ALREADY_EXISTS, NOT_FOUND, UNAUTHORIZED} from "./errors"
import {IsOrganization, IsOrgId} from "./schemas"
import {GG_USER_TOKEN} from "../auth/AuthContext"

export const IsOrgIdRequest = IsObject({
    orgId: IsOrgId,
})

export const IsCreateOrgRequest = IsObject({
    name: IsString,
})

export const IsUpdateOrgRequest = IsObject({
    orgId: IsOrgId,
    name: IsString,
})

export const IsSetHetznerCredentialsRequest = IsObject({
    orgId: IsOrgId,
    apiKey: IsString,
})

export const OrganizationApiContract = new GGContractClass("OrganizationApi", {
    list: {
        success: IsArray(IsOrganization),
        errors: [UNAUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    get: {
        input: IsOrgIdRequest,
        success: IsOrganization,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    create: {
        input: IsCreateOrgRequest,
        success: IsOrganization,
        errors: [UNAUTHORIZED, ALREADY_EXISTS, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    update: {
        input: IsUpdateOrgRequest,
        success: IsOrganization,
        errors: [UNAUTHORIZED, NOT_FOUND, ALREADY_EXISTS, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    delete: {
        input: IsOrgIdRequest,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    setHetznerCredentials: {
        input: IsSetHetznerCredentialsRequest,
        success: IsOrganization,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
})

export const OrganizationApi = httpSchema(OrganizationApiContract)
    .pathPrefix("api")
    .use(GG_USER_TOKEN)
    .routes({
        list: GGRpc.GET("organizations"),
        get: GGRpc.POST("organizations/get"),
        create: GGRpc.POST("organizations"),
        update: GGRpc.POST("organizations/update"),
        delete: GGRpc.POST("organizations/delete"),
        setHetznerCredentials: GGRpc.POST("organizations/set-hetzner-credentials"),
    })
